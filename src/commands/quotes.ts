import type { Command } from "commander";
import { apiRequest, table, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

export function registerQuotes(program: Command): void {
  program
    .command("quotes <submissionId>")
    .description("List instant-quote carrier sessions and their open questions")
    .action(async (submissionId) => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<any[]>(ctx.client, "GET", `/broker/submissions/${submissionId}/api-quotes/sessions`);
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((s) => ({
        session: s.id, carrier: s.carrier_slug, program: s.program_display_name ?? s.program_identifier,
        status: s.status, outcome: s.outcome ?? "", missing: (s.missing_required_questions_json || []).length,
      })), ["session", "carrier", "program", "status", "outcome", "missing"]) + "\n");
    });

  program
    .command("answer <submissionId> <sessionId>")
    .description("Answer a carrier session's questions, e.g. --set years_in_business=8 --set employees=12")
    .option("--set <kv...>", "key=value pairs")
    .action(async (submissionId, sessionId, opts) => {
      const ctx = makeCtx(program.opts());
      const answers: Record<string, string> = {};
      for (const pair of opts.set || []) {
        const i = String(pair).indexOf("=");
        if (i > 0) answers[String(pair).slice(0, i)] = String(pair).slice(i + 1);
      }
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/api-quotes/sessions/${sessionId}/answers`, {
        body: { answers, merge: true },
      });
      if (ctx.json) return printJson(res);
      process.stdout.write(`status: ${res.status} | remaining questions: ${(res.missing_required_questions_json || []).length}\n`);
    });

  program
    .command("request-quote <submissionId> <sessionId>")
    .description("Close a carrier session and request an indication then a quote")
    .action(async (submissionId, sessionId) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/api-quotes/sessions/${sessionId}/close`);
      if (ctx.json) return printJson(res);
      process.stdout.write(`outcome: ${res.outcome} | status: ${res.status}${res.quote_pdf_url ? " | quote: " + res.quote_pdf_url : ""}\n`);
      if ((res.missing_required_questions_json || []).length)
        process.stdout.write(`still needs ${(res.missing_required_questions_json || []).length} answers; use \`hedge answer\`\n`);
    });
}
