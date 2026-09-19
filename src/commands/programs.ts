import type { Command } from "commander";
import { apiRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const CATEGORIES = ["instant_quote", "binding", "specialty"];

function renderQuestions(questions: any[], depth: number): string[] {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  for (const q of questions ?? []) {
    const flags = [q.required ? "required" : "", q.repeatable ? "repeatable" : "", q.depends_on?.length ? `depends on ${q.depends_on.join(",")}` : ""].filter(Boolean);
    const options = q.options?.length ? "  options: " + q.options.map((o: any) => (o.value === undefined ? o.label : o.value)).join("|") : "";
    out.push(`${pad}${q.key}  [${q.type}${flags.length ? "; " + flags.join("; ") : ""}]  ${q.label ?? ""}${options}`);
    if (q.help) out.push(`${pad}    ${q.help}`);
    if (q.questions?.length) out.push(...renderQuestions(q.questions, depth + 1));
  }
  return out;
}

export function registerPrograms(program: Command): void {
  program
    .command("programs")
    .description("The carrier programs your brokerage can quote through Hedge, one row per program with its category (instant_quote, binding, specialty)")
    .option("--category <category>", `filter: ${CATEGORIES.join(", ")}`)
    .option("--lob <slug>", "filter by line of business (canonical slug or alias, e.g. gl)")
    .option("--state <ST>", "filter by 2-letter state")
    .action(async (opts) => {
      if (opts.category && !CATEGORIES.includes(opts.category)) throw new Error(`--category must be one of ${CATEGORIES.join(", ")}`);
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<any[]>(ctx.client, "GET", "/broker/programs", {
        query: { category: opts.category, lob: opts.lob, state: opts.state ? String(opts.state).toUpperCase() : undefined },
      });
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((p) => ({
        program_id: p.program_id,
        market: p.market_name,
        program: p.name,
        category: p.program_category ?? "",
        lines: (p.lines || []).join(","),
        states: p.states == null ? "all" : p.states.join(","),
        enabled: p.enabled ? "yes" : "no",
        schema: p.application_schema_available ? "yes" : "",
      })), ["program_id", "market", "program", "category", "lines", "states", "enabled", "schema"]) + "\n");
      process.stdout.write("\nQuestions an instant-quote program asks: hedge program-schema <programId>\n");
    });

  program
    .command("program-schema <programId>")
    .description("The application question schema for an instant-quote program: sections of questions with stable keys, types, options and dependencies, for your own application builder")
    .option("--lob <slug>", "check the program lists this line")
    .option("--state <ST>", "check the program is available in this state")
    .action(async (programId, opts) => {
      const ctx = makeCtx(program.opts());
      const s = await apiRequest<any>(ctx.client, "GET", `/broker/programs/${programId}/application-schema`, {
        query: { lob: opts.lob, state: opts.state ? String(opts.state).toUpperCase() : undefined },
      });
      if (ctx.json) return printJson(s);
      process.stdout.write(kv({
        program: s.name, program_id: s.program_id, market_id: s.market_id, category: s.program_category,
        contract: s.contract_version, fingerprint: s.schema_fingerprint, title: s.title ?? "",
      }) + "\n");
      if (s.description) process.stdout.write(s.description + "\n");
      for (const section of s.sections ?? []) {
        process.stdout.write(`\n## ${section.label} (${section.key})\n`);
        process.stdout.write(renderQuestions(section.questions, 1).join("\n") + "\n");
      }
      process.stdout.write("\nSave answers against these keys with the application-workspace checkpoint (see docs.hedgespecialty.com).\n");
    });
}
