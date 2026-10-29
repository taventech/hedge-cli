import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { apiRequest, downloadRequest, multipartRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

// Reads of the brokerage's book plus the file-level actions that sit beside
// the flow: list files, attach a document, withdraw, blank forms, policies,
// payments.

const POLICY_DOC_KINDS = ["binder", "policy", "declarations"];

function formatBytes(size: unknown): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerBook(program: Command): void {
  program
    .command("upload <submissionId> <pdf>")
    .description("Attach a PDF (ACORD, loss runs, supplement) to a file; Hedge reads it into the applications")
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
    .command("submissions")
    .description("List your brokerage's submissions")
    .option("--status <state>", "filter by state")
    .option("--search <q>", "filter by insured name")
    .option("--limit <n>", "max rows to return (1-500)")
    .option("--offset <n>", "skip the first n rows (for paging)")
    .option("--updated-since <iso>", "only rows updated at or after this ISO timestamp")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/submissions", {
        query: { status: opts.status, search: opts.search, limit: opts.limit, offset: opts.offset, updated_since: opts.updatedSince },
      });
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({
        id: r.id, insured: r.insured_name, lines: (r.lines || []).join(","), status: r.status_label, premium: r.premium ?? "",
      })), ["id", "insured", "lines", "status", "premium"]) + "\n");
    });

  program
    .command("withdraw <submissionId>")
    .description("Withdraw a file: pulls it from every market and closes it as withdrawn")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/withdraw`, {
        body: opts.producerEmail ? { producer_email: opts.producerEmail } : undefined,
      });
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ outcome: res.outcome, detail: res.detail }) + "\n");
    });

  program
    .command("forms [search]")
    .description('Search the blank application-form catalog, e.g. hedge forms "liquor"')
    .action(async (search) => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/forms", {
        query: { q: search },
      });
      if (ctx.json) return printJson(rows);
      if (!rows.length) {
        process.stdout.write("No forms matched" + (search ? ` "${search}"` : "") + ".\n");
        return;
      }
      process.stdout.write(table(rows.map((f) => ({
        form_key: f.form_key, title: f.title ?? "", acord: f.is_acord ? "yes" : "", pages: f.page_count ?? "",
      })), ["form_key", "title", "acord", "pages"]) + "\n");
      process.stdout.write("\nDownload a blank with: hedge form <form_key>\n");
    });

  program
    .command("form <formKey>")
    .description("Download a blank application form by its catalog key (the keys hedge forms lists)")
    .option("-o, --output <file>", "output file (default <formKey>.pdf)")
    .action(async (formKey, opts) => {
      const ctx = makeCtx(program.opts());
      const out = await downloadRequest(ctx.client, "GET", `/broker/forms/${encodeURIComponent(formKey)}/pdf`, opts.output, `${formKey}.pdf`);
      process.stdout.write("Saved " + out + "\n");
    });

  program
    .command("documents <submissionId>")
    .description("List a submission's finalized documents (ACORDs, quotes, binders)")
    .action(async (submissionId) => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", `/broker/submissions/${submissionId}/finalized-documents`);
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((d) => ({
        id: d.id, name: d.display_name, kind: d.source_label ?? d.source, size: formatBytes(d.size_bytes ?? d.size), added: String(d.created_at ?? "").slice(0, 10),
      })), ["id", "name", "kind", "size", "added"]) + "\n");
    });

  program
    .command("download <documentId>")
    .description("Download a finalized document PDF")
    .option("-o, --output <file>", "output file (default: the server's filename, else <documentId>.pdf)")
    .action(async (documentId, opts) => {
      const ctx = makeCtx(program.opts());
      const out = await downloadRequest(ctx.client, "GET", `/broker/finalized-documents/${documentId}/pdf`, opts.output, `${documentId}.pdf`);
      process.stdout.write("Saved " + out + "\n");
    });

  program
    .command("policies")
    .description("List bound policies")
    .action(async () => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/policies");
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({
        insured: r.insured_name, carrier: r.carrier_name, policy: r.policy_number, premium: r.premium ?? "",
        effective: r.effective_date ?? "", expiration: r.expiration_date ?? "", status: r.status_label ?? r.status,
      })), ["insured", "carrier", "policy", "premium", "effective", "expiration", "status"]) + "\n");
    });

  program
    .command("policy <policyId>")
    .description("Policy detail: term, premium, commission, payment plan, documents")
    .action(async (policyId) => {
      const ctx = makeCtx(program.opts());
      const p = await apiRequest<Record<string, any>>(ctx.client, "GET", `/broker/policies/${policyId}`);
      if (ctx.json) return printJson(p);
      process.stdout.write(kv({
        insured: p.insured_name,
        policy: p.policy_number,
        carrier: p.carrier_name,
        lines: (p.lines || []).join(", "),
        term: [p.effective_date, p.expiration_date].filter(Boolean).join(" to "),
        net_premium: p.net_premium,
        total_billed: p.total_billed,
        commission_rate: p.commission_rate,
        commission_amount: p.commission_amount,
        payment_plan: p.payment_plan,
      }) + "\n");
      if (p.documents?.length) {
        process.stdout.write("\nDocuments: " + p.documents.map((d: any) => d.kind).join(", ") + "\n");
        process.stdout.write("Download with: hedge policy-doc " + policyId + " <kind>\n");
      }
    });

  program
    .command("policy-doc <policyId> <kind>")
    .description("Download a policy PDF; kind is one of binder, policy, declarations")
    .option("-o, --output <file>", "output file (default <policyId>-<kind>.pdf)")
    .action(async (policyId, kind, opts) => {
      if (!POLICY_DOC_KINDS.includes(kind)) throw new Error(`kind must be one of ${POLICY_DOC_KINDS.join(", ")} (got "${kind}")`);
      const ctx = makeCtx(program.opts());
      const out = await downloadRequest(ctx.client, "GET", `/broker/policies/${policyId}/document/${kind}`, opts.output ?? `${policyId}-${kind}.pdf`);
      process.stdout.write("Saved " + out + "\n");
    });

  program
    .command("payments")
    .description("List payment / invoice status")
    .action(async () => {
      const ctx = makeCtx(program.opts());
      const rows = await apiRequest<Record<string, any>[]>(ctx.client, "GET", "/broker/payments");
      if (ctx.json) return printJson(rows);
      process.stdout.write(table(rows.map((r) => ({
        insured: r.insured_name, status: r.status_label ?? r.status, premium: r.premium ?? "", invoice_url: r.invoice_url ?? "",
      })), ["insured", "status", "premium", "invoice_url"]) + "\n");
    });
}
