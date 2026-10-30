import type { Command } from "commander";
import { apiRequest, table, printJson } from "../core/index.js";
import { makeCtx, type Ctx } from "../context.js";
import { listFlag, renderEmailUs } from "../render.js";

// The read half of the flow: which Hedge Instant Quote markets fit
// (appetite), then everything they need (requirements).

function appetiteBody(opts: any, description?: string): Record<string, unknown> {
  const lines = listFlag(opts.lines);
  if (!opts.state) throw new Error("--state is required (2-letter risk state)");
  if (!lines.length) throw new Error("--lines is required, e.g. --lines gl or --lines gl,property");
  const body: Record<string, unknown> = { state: String(opts.state).trim().toUpperCase(), lines };
  if (opts.naics) body.naics = String(opts.naics).trim();
  if (description?.trim()) body.description = description.trim();
  return body;
}

async function checkAppetite(ctx: Ctx, body: Record<string, unknown>): Promise<any> {
  return apiRequest<any>(ctx.client, "POST", "/broker/appetite/instant", { body });
}

function questionRow(programId: string, q: any): Record<string, unknown> {
  const bound = q.key && !String(q.key).startsWith("program.");
  const options = (q.options ?? []).map((o: any) => String(o.value ?? o.label)).join("|");
  return {
    set: bound ? q.key : `${programId}:${q.id}`,
    label: q.label ?? "",
    type: q.type ?? "",
    required: q.required ? "yes" : q.required_if?.length || q.show_if?.length ? "if shown" : "",
    options: options.length > 60 ? options.slice(0, 57) + "..." : options,
    prefilled_from: q.prefilled_from ?? "",
  };
}

export function registerFlow(program: Command): void {
  program
    .command("appetite [description]")
    .summary("Which Hedge Instant Quote markets fit a risk")
    .description(
      'Which Hedge Instant Quote markets will quote a risk, e.g. hedge appetite "residential landscaping, 6 employees" --state CA --lines gl --naics 561730. When none fits, prints where to email it instead',
    )
    .option("--state <ST>", "2-letter risk state (required)")
    .option("--lines <slugs>", "comma-separated lines of coverage, e.g. gl,property,workers_compensation (required)")
    .option("--naics <code>", "6-digit NAICS; markets that class by NAICS need it")
    .action(async (description: string | undefined, opts) => {
      const ctx = makeCtx(program.opts());
      const body = appetiteBody(opts, description);
      const res = await checkAppetite(ctx, body);
      if (ctx.json) return printJson(res);
      if (!res.instant_available) {
        process.stdout.write("No Hedge Instant Quote market fits this risk; it can't be filed over the API.\n\n" + renderEmailUs(res.email_us) + "\n");
        return;
      }
      process.stdout.write(
        table(
          (res.instant_markets ?? []).map((m: any) => ({
            market: m.market,
            program: m.program,
            lines: (m.lines ?? []).join(","),
            class: m.class?.suggested?.label ?? (m.asks_class ? "(Hedge suggests one after create)" : ""),
            program_id: m.program_id,
          })),
          ["market", "program", "lines", "class", "program_id"],
        ) + "\n",
      );
      process.stdout.write(`\nNext: hedge requirements --state ${body.state} --lines ${(body.lines as string[]).join(",")}  (what these markets need)\n`);
    });

  program
    .command("requirements")
    .summary("The core fields and each instant market's questions")
    .description(
      "Everything Hedge needs to quote: the core fields of a file plus each instant market's own questions, per market. Without --programs it uses every market hedge appetite returns",
    )
    .option("--state <ST>", "2-letter risk state (required)")
    .option("--lines <slugs>", "comma-separated lines of coverage (required)")
    .option("--programs <ids>", "comma-separated program ids from hedge appetite (default: all of them)")
    .option("--naics <code>", "6-digit NAICS, used to pick the markets when --programs is omitted")
    .option("--description <text>", "what the business does, used to pick the markets when --programs is omitted")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const base = appetiteBody(opts, opts.description);
      let programIds = listFlag(opts.programs);
      if (!programIds.length) {
        const appetite = await checkAppetite(ctx, base);
        if (!appetite.instant_available) {
          if (ctx.json) return printJson(appetite);
          process.stdout.write("No Hedge Instant Quote market fits this risk; it can't be filed over the API.\n\n" + renderEmailUs(appetite.email_us) + "\n");
          return;
        }
        programIds = (appetite.instant_markets ?? []).map((m: any) => String(m.program_id));
      }
      const res = await apiRequest<any>(ctx.client, "POST", "/broker/requirements", {
        body: { program_ids: programIds, state: base.state, lines: base.lines },
      });
      if (ctx.json) return printJson(res);
      process.stdout.write(
        "Core (fields of the create body):\n" +
          table(
            (res.core ?? []).map((f: any) => ({ key: f.key, label: f.label ?? "", type: f.type ?? "", required: f.required ? "yes" : "" })),
            ["key", "label", "type", "required"],
          ) +
          "\n",
      );
      for (const m of res.markets ?? []) {
        process.stdout.write(`\n${m.market} / ${m.program}  (program ${m.program_id})\n`);
        process.stdout.write(
          table(
            (m.questions ?? []).map((q: any) => questionRow(m.program_id, q)),
            ["set", "label", "type", "required", "options", "prefilled_from"],
          ) + "\n",
        );
      }
      process.stdout.write(
        "\nAnswer with --set on hedge create or hedge answer. A canonical key is answered once for every market that asks it;" +
          " <program_id>:<id> answers one market's own question.\n",
      );
    });
}
