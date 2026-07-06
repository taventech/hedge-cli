import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { apiRequest, multipartRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

export function registerSubmissions(program: Command): void {
  program
    .command("submit")
    .description("Create a submission (does not market it — run `finalize` when ready)")
    .requiredOption("--insured <name>", "insured business name")
    .requiredOption("--narrative <text>", "operations description of the risk")
    .option("--lob <slugs>", "comma-separated lines of business, e.g. commercial_general_liability,workers_compensation")
    .option("--effective <date>", "effective date, YYYY-MM-DD")
    .option("--state <ST>", "primary state (2-letter)")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, unknown> = {
        applicant: { insured_name: opts.insured, ...(opts.state ? { mailing_address: undefined } : {}) },
        narrative: opts.narrative,
        lines_of_business: opts.lob ? String(opts.lob).split(",").map((s: string) => s.trim()) : [],
      };
      if (opts.effective) body.effective_date = opts.effective;
      const res = await apiRequest<Record<string, unknown>>(ctx.client, "POST", "/broker/submissions", { body });
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ submission_id: res.submission_id, state: res.state, status: res.status_label }) + "\n");
      process.stdout.write("\nNext: hedge upload " + res.submission_id + " <file.pdf>, hedge requirements " + res.submission_id + ", hedge finalize " + res.submission_id + "\n");
    });

  program
    .command("upload <submissionId> <pdf>")
    .description("Attach a PDF (ACORD, loss runs, supplement) to a submission")
    .option("--name <label>", "display name for the document")
    .action(async (submissionId, pdf, opts) => {
      const ctx = makeCtx(program.opts());
      const bytes = readFileSync(pdf);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "application/pdf" }), basename(pdf));
      if (opts.name) form.append("display_name", opts.name);
      const res = await multipartRequest<Record<string, any>>(ctx.client, "POST", `/broker/submissions/${submissionId}/documents`, form);
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ document_id: res.id, name: res.display_name, kind: res.source_label ?? res.source }) + "\n");
    });

  program
    .command("requirements <submissionId>")
    .description("What this submission still needs (per-market, forms, carrier questions)")
    .action(async (submissionId) => {
      const ctx = makeCtx(program.opts());
      const r = await apiRequest<Record<string, any>>(ctx.client, "GET", `/broker/submissions/${submissionId}/requirements`);
      if (ctx.json) return printJson(r);
      process.stdout.write(kv({ insured: r.insured_name, lines: (r.lines || []).join(", "), state: r.state, forms: (r.forms || []).join(", ") }) + "\n");
      if (r.markets?.length) {
        process.stdout.write("\nMarkets:\n" + table(r.markets.map((m: any) => ({
          market: m.market_name, ready: m.ready ? "yes" : "no", needs_from_you: (m.needs_from_you || []).join("; "),
        })), ["market", "ready", "needs_from_you"]) + "\n");
      }
      if (r.carrier_api_sessions?.length) {
        process.stdout.write("\nInstant-quote carriers:\n" + table(r.carrier_api_sessions.map((s: any) => ({
          carrier: s.carrier_slug, program: s.program, status: s.status, missing: (s.missing_questions || []).length, quote: s.has_quote ? "yes" : "",
        })), ["carrier", "program", "status", "missing", "quote"]) + "\n");
      }
    });

  program
    .command("status <submissionId>")
    .description("Submission detail + live marketing/quote status")
    .action(async (submissionId) => {
      const ctx = makeCtx(program.opts());
      const s = await apiRequest<Record<string, any>>(ctx.client, "GET", `/broker/submissions/${submissionId}`);
      if (ctx.json) return printJson(s);
      process.stdout.write(kv({ insured: s.insured_name, lines: (s.lines || []).join(", "), state: s.state, status: s.status_label, premium: s.premium }) + "\n");
    });

  program
    .command("submissions")
    .description("List your brokerage's submissions")
    .option("--status <state>", "filter by state")
    .option("--search <q>", "filter by insured name")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/submissions", {
        query: { status: opts.status, search: opts.search },
      });
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({
        id: r.id, insured: r.insured_name, lines: (r.lines || []).join(","), status: r.status_label, premium: r.premium ?? "",
      })), ["id", "insured", "lines", "status", "premium"]) + "\n");
    });

  program
    .command("finalize <submissionId>")
    .description("Start marketing the submission to carriers")
    .action(async (submissionId) => {
      const ctx = makeCtx(program.opts());
      const r = await apiRequest<Record<string, unknown>>(ctx.client, "POST", `/broker/submissions/${submissionId}/finalize`);
      if (ctx.json) return printJson(r);
      process.stdout.write("Marketing started. Track with: hedge status " + submissionId + "\n");
    });

  program
    .command("policies")
    .description("List bound policies")
    .action(async () => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/policies");
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({ insured: r.insured_name, carrier: r.carrier_name, policy: r.policy_number, premium: r.premium ?? "", status: r.status_label ?? r.status })), ["insured", "carrier", "policy", "premium", "status"]) + "\n");
    });

  program
    .command("payments")
    .description("List payment / invoice status")
    .action(async () => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/payments");
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({ insured: r.insured_name, status: r.status_label ?? r.status, premium: r.premium ?? "" })), ["insured", "status", "premium"]) + "\n");
    });
}
