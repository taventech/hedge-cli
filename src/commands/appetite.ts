import type { Command } from "commander";
import { apiRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

function requirementRows(items: any[]): Record<string, unknown>[] {
  return items.map((q: any) => ({
    requirement: q.label + (q.conditional ? " (conditional)" : ""),
    severity: q.severity,
    provided_by: q.provided_by,
  }));
}

export function registerAppetite(program: Command): void {
  program
    .command("appetite <class>")
    .description('Which markets have appetite for a class, e.g. hedge appetite "roofing contractor" --state CA')
    .option("--state <ST>", "2-letter state")
    .option("--lob <slug>", "line of business filter")
    .action(async (klass, opts) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "GET", "/broker/appetite", {
        query: { q: klass, state: opts.state, lob: opts.lob },
      });
      if (ctx.json) return printJson(res);
      const rows = (res.results || []).map((m: any) => ({
        market: m.name,
        lines: (m.lines || []).map((l: any) => l.slug ?? l).join(","),
        programs: (m.matched_program_names || []).join("; "),
        turnaround: m.turnaround?.median_hours != null ? `${Math.round(m.turnaround.median_hours)}h median` : "",
      }));
      process.stdout.write(table(rows, ["market", "lines", "programs", "turnaround"]) + "\n");
    });

  program
    .command("market-requirements <marketId>")
    .description("What a market needs to quote a line: the application package plus per-program requirements (market ids come from `hedge appetite --json`)")
    .requiredOption("--lob <slug>", "line of business, e.g. commercial_general_liability")
    .option("--state <ST>", "2-letter state")
    .option("--programs <keys>", "comma-separated program keys (matched_program_keys from the appetite result) to narrow the panel")
    .action(async (marketId, opts) => {
      const ctx = makeCtx(program.opts());
      const r = await apiRequest<any>(ctx.client, "GET", `/broker/markets/${marketId}/requirements`, {
        query: { lob: opts.lob, state: opts.state, programs: opts.programs },
      });
      if (ctx.json) return printJson(r);
      process.stdout.write(kv({
        market: r.market_name,
        line: r.lob?.label ?? r.lob?.slug,
        state: r.state ?? "",
        channel: r.market_channel,
      }) + "\n");
      if (r.baseline?.length) {
        process.stdout.write("\nApplication package (Hedge prepares these):\n" +
          table(requirementRows(r.baseline), ["requirement", "severity", "provided_by"]) + "\n");
      }
      for (const p of r.programs || []) {
        const lines = (p.lines || []).map((l: any) => l.label ?? l.slug).join(", ");
        process.stdout.write(`\nProgram: ${p.display_name} [${p.channel}]${lines ? " (" + lines + ")" : ""}\n`);
        if (p.has_authored_requirements && p.requirements?.length) {
          process.stdout.write(table(requirementRows(p.requirements), ["requirement", "severity", "provided_by"]) + "\n");
        } else {
          process.stdout.write("Standard application package; no carrier-specific requirements.\n");
        }
      }
      if (r.other_program_count) {
        process.stdout.write(`\n${r.other_program_count} more program(s) use the standard package.\n`);
      }
    });
}
