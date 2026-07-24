import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { apiRequest, downloadRequest, multipartRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const POLICY_DOC_KINDS = ["binder", "policy", "declarations"];

// Strict non-negative integer parse for count/amount flags.
function intFlag(value: string, flag: string): number {
  if (!/^\d+$/.test(String(value).trim())) throw new Error(`${flag} expects a whole number, got "${value}"`);
  return Number.parseInt(String(value).trim(), 10);
}

// --body source: a JSON file path, or "-" for stdin.
function readJsonBody(source: string): Record<string, unknown> {
  const raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`--body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function formatBytes(size: unknown): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerSubmissions(program: Command): void {
  program
    .command("submit")
    .description("Create a submission (does not market it; run `finalize` when ready)")
    .option("--insured <name>", "insured business name (required unless --body supplies applicant.insured_name)")
    .option("--narrative <text>", "operations description of the risk (required unless --body supplies narrative)")
    .option("--lob <slugs>", "comma-separated lines of business, e.g. commercial_general_liability,workers_compensation")
    .option("--effective <date>", "effective date, YYYY-MM-DD")
    .option("--state <ST>", "primary state (2-letter); with any address flag it becomes the mailing address state instead")
    .option("--website <url>", "insured website")
    .option("--fein <id>", "FEIN (or SSN for a sole proprietor)")
    .option("--entity-type <type>", "legal entity type, e.g. llc, corporation")
    .option("--naics <code>", "NAICS code")
    .option("--business-phone <phone>", "insured business phone")
    .option("--business-email <email>", "insured business email")
    .option("--contact-first <name>", "primary contact first name")
    .option("--contact-last <name>", "primary contact last name")
    .option("--contact-email <email>", "primary contact email")
    .option("--contact-phone <phone>", "primary contact phone")
    .option("--address <line1>", "mailing address line 1")
    .option("--address2 <line2>", "mailing address line 2")
    .option("--city <city>", "mailing address city")
    .option("--zip <zip>", "mailing address ZIP code")
    .option("--tiv <int>", "total insured property value in dollars (property_tiv_total)")
    .option("--vehicles <int>", "number of vehicles (auto_vehicle_count)")
    .option("--payroll <int>", "total annual payroll in dollars (wc_total_annual_payroll)")
    .option("--insured-id <uuid>", "start from an existing insured in your book")
    .option("--producer-email <email>", "producing broker to attribute (required for brokerage API-client credentials)")
    .option(
      "--body <file|->",
      "full JSON request body from a file, or - for stdin. Precedence: flags win; a top-level flag value replaces the matching body key, applicant flags merge over the body's applicant, and address flags merge into its mailing_address",
    )
    .option(
      "--idempotency-key <key>",
      "Idempotency-Key header value (default: a random UUID per invocation). Re-send the same key within 24h to replay the original response instead of creating a duplicate",
    )
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, unknown> = opts.body ? readJsonBody(opts.body) : { lines_of_business: [] };

      const applicant: Record<string, unknown> = {};
      if (opts.insured) applicant.insured_name = opts.insured;
      if (opts.businessPhone) applicant.business_phone = opts.businessPhone;
      if (opts.businessEmail) applicant.business_email = opts.businessEmail;
      if (opts.website) applicant.website = opts.website;
      if (opts.fein) applicant.fein_or_ssn = opts.fein;
      if (opts.entityType) applicant.entity_type = opts.entityType;
      if (opts.naics) applicant.naics = opts.naics;
      if (opts.contactFirst) applicant.contact_first_name = opts.contactFirst;
      if (opts.contactLast) applicant.contact_last_name = opts.contactLast;
      if (opts.contactEmail) applicant.contact_email = opts.contactEmail;
      if (opts.contactPhone) applicant.contact_phone = opts.contactPhone;

      const addressFlags: Record<string, unknown> = {};
      if (opts.address) addressFlags.line1 = opts.address;
      if (opts.address2) addressFlags.line2 = opts.address2;
      if (opts.city) addressFlags.city = opts.city;
      if (opts.zip) addressFlags.zip = opts.zip;
      const hasAddressFlags = Object.keys(addressFlags).length > 0;
      const state = opts.state ? String(opts.state).trim().toUpperCase() : undefined;

      const bodyApplicant =
        body.applicant && typeof body.applicant === "object" && !Array.isArray(body.applicant)
          ? (body.applicant as Record<string, unknown>)
          : undefined;
      const bodyAddress =
        bodyApplicant?.mailing_address && typeof bodyApplicant.mailing_address === "object" && !Array.isArray(bodyApplicant.mailing_address)
          ? (bodyApplicant.mailing_address as Record<string, unknown>)
          : undefined;

      // Address flags merge INTO the body's mailing_address (nested merge),
      // so --body plus one corrected field keeps the rest of the address.
      let mailing: Record<string, unknown> | undefined = bodyAddress ? { ...bodyAddress } : undefined;
      if (hasAddressFlags) mailing = { ...(mailing ?? {}), ...addressFlags };
      if (state) {
        if (mailing) {
          // Flags win: --state lands on the mailing address rather than as a
          // conflicting top-level primary_state (which would 422). A
          // primary_state already present in the body is kept in agreement.
          mailing.state = state;
          if (body.primary_state != null) body.primary_state = state;
        } else {
          body.primary_state = state;
        }
      }
      if (hasAddressFlags) {
        // The API requires a complete mailing address (line1, city, state,
        // zip); a partial one is a guaranteed 422, so fail fast instead.
        const flagFor: Record<string, string> = { line1: "--address", city: "--city", state: "--state", zip: "--zip" };
        const missing = Object.keys(flagFor).filter((k) => !mailing?.[k]).map((k) => flagFor[k]);
        if (missing.length) {
          throw new Error(
            "--address, --city, --state and --zip must be provided together (missing " + missing.join(", ") + "; fields already in --body's mailing_address count)",
          );
        }
      }
      if (mailing && (hasAddressFlags || state)) applicant.mailing_address = mailing;

      if (Object.keys(applicant).length > 0) {
        body.applicant = { ...(bodyApplicant ?? {}), ...applicant };
      }

      if (opts.narrative) body.narrative = opts.narrative;
      if (opts.lob) body.lines_of_business = String(opts.lob).split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.effective) body.effective_date = opts.effective;
      if (opts.tiv != null) body.property_tiv_total = intFlag(opts.tiv, "--tiv");
      if (opts.vehicles != null) body.auto_vehicle_count = intFlag(opts.vehicles, "--vehicles");
      if (opts.payroll != null) body.wc_total_annual_payroll = intFlag(opts.payroll, "--payroll");
      if (opts.insuredId) body.insured_id = opts.insuredId;
      if (opts.producerEmail) body.producer_email = opts.producerEmail;

      const finalApplicant = body.applicant as Record<string, unknown> | undefined;
      if (!finalApplicant?.insured_name) throw new Error("--insured is required (or supply applicant.insured_name via --body)");
      if (!body.narrative) throw new Error("--narrative is required (or supply narrative via --body)");

      const res = await apiRequest<Record<string, unknown>>(ctx.client, "POST", "/broker/submissions", {
        body,
        // Random per invocation unless the caller supplies a key. The API
        // replays the original response when the same key is re-sent within
        // 24h (per brokerage), so scripted retries should pass their own key.
        headers: { "Idempotency-Key": opts.idempotencyKey ?? randomUUID() },
      });
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
      } else {
        // An empty markets list is ambiguous without the server's
        // marketing_status: matching runs for ~5 minutes after finalize.
        const hint = typeof r.marketing_hint === "string" && r.marketing_hint ? r.marketing_hint : null;
        if (r.marketing_status === "matching") {
          process.stdout.write("\nNo markets yet - " + (hint ?? "Hedge is matching carrier markets now (usually ~5 minutes after finalize); re-run this in a few minutes.") + "\n");
        } else if (r.marketing_status === "not_started") {
          process.stdout.write("\nNo markets yet - " + (hint ?? "run hedge finalize " + submissionId + " to start marketing.") + "\n");
        } else if (r.marketing_status === "no_markets_matched") {
          process.stdout.write("\nNo markets attached - " + (hint ?? "Hedge is reviewing options for this risk and will follow up.") + "\n");
        } else {
          process.stdout.write("\nNo markets yet. If you just finalized, matching usually completes within ~5 minutes - re-run this shortly or use hedge status " + submissionId + ".\n");
        }
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
      process.stdout.write(kv({ insured: s.insured_name, lines: (s.lines || []).join(", "), state: s.state, status: s.status_label, premium: s.premium, effective: s.effective_date }) + "\n");
      if (s.markets?.length) {
        process.stdout.write("\nMarkets:\n" + table(s.markets.flatMap((m: any) => (m.lines || []).map((l: any) => ({
          carrier: m.carrier_name, line: l.lob_label ?? l.lob_slug, status: l.status_label ?? l.status, quote: l.quote_premium ?? "",
        }))), ["carrier", "line", "status", "quote"]) + "\n");
      } else {
        process.stdout.write("\nNo markets attached yet. Matching usually completes within ~5 minutes of finalize - re-run this shortly (or check hedge requirements " + submissionId + ").\n");
      }
      const byStatus = s.status_summary?.by_status;
      if (byStatus && Object.keys(byStatus).length) {
        process.stdout.write("\nSummary: " + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ") + "\n");
      }
      if (s.documents?.length) {
        process.stdout.write("\nDocuments: " + s.documents.map((d: any) => d.display_name).join(", ") + "\n");
      }
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
    .command("finalize <submissionId>")
    .description("Start marketing the submission to carriers")
    .option("--wait", "poll until markets attach (usually ~5 minutes), then print them")
    .option("--timeout <minutes>", "how long --wait polls before giving up", "8")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const r = await apiRequest<Record<string, any>>(ctx.client, "POST", `/broker/submissions/${submissionId}/finalize`);
      if (ctx.json && !opts.wait) return printJson(r);

      if (!opts.wait) {
        // Matching is asynchronous — set the expectation so nobody polls
        // requirements 10 seconds from now and reads "empty" as "no appetite".
        const wait = Number(r.typical_wait_seconds) > 0 ? Math.round(Number(r.typical_wait_seconds) / 60) : 5;
        process.stdout.write(
          `Marketing started. Markets usually attach within ~${wait} minutes.\n` +
          `Track with: hedge status ${submissionId}  (or use finalize --wait next time)\n`,
        );
        return;
      }

      const timeoutMin = intFlag(opts.timeout, "--timeout");
      const deadline = Date.now() + Math.max(1, timeoutMin) * 60_000;
      process.stdout.write("Marketing started - waiting for markets to attach (usually ~5 minutes)");
      let markets: any[] = [];
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        process.stdout.write(".");
        const s = await apiRequest<Record<string, any>>(ctx.client, "GET", `/broker/submissions/${submissionId}`);
        if (s.markets?.length) {
          markets = s.markets;
          break;
        }
      }
      process.stdout.write("\n");
      if (!markets.length) {
        process.stdout.write(
          `Still matching after ${timeoutMin} minutes - this can occasionally take longer.\n` +
          `Check in with: hedge status ${submissionId}  or  hedge requirements ${submissionId}\n`,
        );
        return;
      }
      const rows = markets.flatMap((m: any) => (m.lines || []).map((l: any) => ({
        carrier: m.carrier_name, line: l.lob_label ?? l.lob_slug, status: l.status_label ?? l.status,
      })));
      if (ctx.json) return printJson({ finalize: r, markets });
      process.stdout.write(`Matched ${markets.length} market(s):\n\n` + table(rows, ["carrier", "line", "status"]) + "\n");
      process.stdout.write("\nNext: hedge requirements " + submissionId + " shows what each market still needs from you.\n");
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
