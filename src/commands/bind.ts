import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { ApiError, apiRequest, multipartRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const PAYMENT_OPTIONS = ["in_full", "monthly"];

// --attest confirms every standing assumption; --attest-keys only the named
// ones. Both is a contradiction; neither confirms nothing (the default).
function attestValue(opts: { attest?: boolean; attestKeys?: string }): boolean | string[] {
  if (opts.attest && opts.attestKeys) throw new Error("pass --attest or --attest-keys, not both");
  if (opts.attest) return true;
  if (opts.attestKeys) {
    const keys = String(opts.attestKeys).split(",").map((s) => s.trim()).filter(Boolean);
    if (!keys.length) throw new Error("--attest-keys needs at least one key");
    return keys;
  }
  return false;
}

function fmtAssumption(a: any): string {
  const value = a.value === undefined || a.value === null ? "" : ` = ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`;
  return `  - ${a.key}: ${a.label ?? ""}${value}`;
}

// The 409 a bind create/submit answers while assumptions stand unconfirmed.
// The body is {detail: {code: "assumptions_unconfirmed", bind_request_id,
// assumptions: [...]}}; anything else is not ours to handle.
function unconfirmedFrom(err: unknown): any | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { detail?: any } | undefined;
  const detail = body?.detail;
  if (detail && typeof detail === "object" && detail.code === "assumptions_unconfirmed") return detail;
  return null;
}

function printUnconfirmed(detail: any, howToAttest: string, json: boolean): void {
  if (json) {
    printJson(detail);
  } else {
    process.stdout.write(
      `Assumptions unconfirmed (bind request ${detail.bind_request_id} kept as a draft; nothing was sent to the carrier).\n\n` +
        "Hedge obtained this quote on these assumptions. The retail agent must review each statement and confirm it:\n" +
        (detail.assumptions || []).map(fmtAssumption).join("\n") +
        "\n\nOnce reviewed, confirm and continue with:\n" +
        `  ${howToAttest} --attest\n` +
        `  ${howToAttest} --attest-keys ${(detail.assumptions || []).map((a: any) => a.key).join(",") || "<key,key>"}   (only the keys the agent confirmed)\n`,
    );
  }
  process.exitCode = 1;
}

export function printBindRequest(r: any): void {
  process.stdout.write(kv({
    bind_request_id: r.bind_request_id,
    status: `${r.status}${r.status_label ? " (" + r.status_label + ")" : ""}`,
    quote_id: r.quote_id ?? "",
    payment: r.payment_option ?? "",
    requested_at: r.requested_at ?? "",
    requested_by: r.requested_by ?? "",
    effective: r.effective_date ?? "",
    policy_id: r.policy_id ?? "",
  }) + "\n");
  if (r.unconfirmed_assumptions?.length) {
    process.stdout.write("\nUnconfirmed assumptions (create/submit answer 409 until attested):\n" + r.unconfirmed_assumptions.map(fmtAssumption).join("\n") + "\n");
  }
  if (r.contingencies?.length) {
    process.stdout.write("\nContingencies:\n" + table(r.contingencies.map((c: any) => ({
      id: c.id, kind: c.kind, label: c.label, status: c.status, required: c.required ? "yes" : "no", esign: c.esign_status ?? "", upload: c.upload_path ? "hedge bind-upload ... " + c.id + " <file.pdf>" : "",
    })), ["id", "kind", "label", "status", "required", "esign", "upload"]) + "\n");
  }
  if (r.next_steps?.length) {
    process.stdout.write("\nNext steps:\n" + r.next_steps.map((s: string) => "  - " + s).join("\n") + "\n");
  }
}

export function registerBind(program: Command): void {
  program
    .command("bind <submissionId>")
    .description(
      "Request to bind a released quote (the broker's bind authority). Drafts the bind request with one slot per carrier contingency; answers 409 with the assumptions to attest while any stand unconfirmed",
    )
    .requiredOption("--quote <quoteId>", "the released quote to bind: a quote_id from hedge markets (indications cannot be bound)")
    .option("--payment <option>", `payment plan: ${PAYMENT_OPTIONS.join(" or ")}`, "in_full")
    .option("--attest", "confirm EVERY standing assumption on the quote's carrier application. Only after the retail agent has reviewed each statement; the confirmation is recorded under the producing broker")
    .option("--attest-keys <keys>", "confirm only these assumption keys, comma-separated")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .action(async (submissionId, opts) => {
      if (!PAYMENT_OPTIONS.includes(opts.payment)) throw new Error(`--payment must be ${PAYMENT_OPTIONS.join(" or ")}`);
      const ctx = makeCtx(program.opts());
      const body: Record<string, unknown> = { quote_id: opts.quote, payment_option: opts.payment, attest_assumptions: attestValue(opts) };
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      let r: any;
      try {
        r = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/bind-requests`, { body });
      } catch (err) {
        const detail = unconfirmedFrom(err);
        if (!detail) throw err;
        printUnconfirmed(detail, `hedge bind ${submissionId} --quote ${opts.quote} --payment ${opts.payment}${opts.producerEmail ? " --producer-email " + opts.producerEmail : ""}`, ctx.json);
        return;
      }
      if (ctx.json) return printJson(r);
      printBindRequest(r);
      if (r.status === "drafted") {
        process.stdout.write(
          `\nUpload contingency documents with hedge bind-upload ${submissionId} ${r.bind_request_id} <contingencyId> <file.pdf>, ` +
            `then send it to Hedge for placement: hedge bind-submit ${submissionId} ${r.bind_request_id}\n`,
        );
      }
    });

  program
    .command("bind-status <submissionId> [bindRequestId]")
    .description("Bind requests on a submission (newest first), or one request in full: status, unconfirmed assumptions, contingencies, next steps")
    .action(async (submissionId, bindRequestId) => {
      const ctx = makeCtx(program.opts());
      if (bindRequestId) {
        const r = await apiRequest<any>(ctx.client, "GET", `/broker/submissions/${submissionId}/bind-requests/${bindRequestId}`);
        if (ctx.json) return printJson(r);
        printBindRequest(r);
        return;
      }
      const rows = await apiRequest<any[]>(ctx.client, "GET", `/broker/submissions/${submissionId}/bind-requests`);
      if (ctx.json) return printJson(rows);
      if (!rows.length) {
        process.stdout.write(`No bind requests yet. Start one with: hedge bind ${submissionId} --quote <quoteId>\n`);
        return;
      }
      process.stdout.write(table(rows.map((r) => ({
        bind_request_id: r.bind_request_id,
        status: r.status_label ?? r.status,
        quote_id: r.quote_id ?? "",
        requested_at: String(r.requested_at ?? "").slice(0, 16).replace("T", " "),
        unconfirmed: (r.unconfirmed_assumptions || []).length,
        pending: (r.contingencies || []).filter((c: any) => c.status === "pending").length,
        policy_id: r.policy_id ?? "",
      })), ["bind_request_id", "status", "quote_id", "requested_at", "unconfirmed", "pending", "policy_id"]) + "\n");
      process.stdout.write(`\nDetail: hedge bind-status ${submissionId} <bindRequestId>\n`);
    });

  program
    .command("bind-upload <submissionId> <bindRequestId> <contingencyId> <pdf>")
    .description("Attach a PDF to a pre-bind contingency (accepted while the request is drafted); marks the item satisfied")
    .option("--notes <text>", "notes for the underwriter")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .action(async (submissionId, bindRequestId, contingencyId, pdf, opts) => {
      const ctx = makeCtx(program.opts());
      const form = new FormData();
      form.append("file", new Blob([readFileSync(pdf)], { type: "application/pdf" }), basename(pdf));
      if (opts.notes) form.append("notes", opts.notes);
      if (opts.producerEmail) form.append("producer_email", opts.producerEmail);
      const r = await multipartRequest<any>(
        ctx.client,
        "POST",
        `/broker/submissions/${submissionId}/bind-requests/${bindRequestId}/contingencies/${contingencyId}/document`,
        form,
      );
      if (ctx.json) return printJson(r);
      printBindRequest(r);
    });

  program
    .command("bind-submit <submissionId> <bindRequestId>")
    .description("Submit the drafted bind request to Hedge for placement with the carrier; answers 409 with the assumptions to attest while any stand unconfirmed")
    .option("--attest", "confirm EVERY standing assumption and submit in one call (only after the retail agent has reviewed each statement)")
    .option("--attest-keys <keys>", "confirm only these assumption keys, comma-separated")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .action(async (submissionId, bindRequestId, opts) => {
      const ctx = makeCtx(program.opts());
      const attest = attestValue(opts);
      const body: Record<string, unknown> = {};
      if (attest !== false) body.attest_assumptions = attest;
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      let r: any;
      try {
        r = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/bind-requests/${bindRequestId}/submit`, {
          body: Object.keys(body).length ? body : undefined,
        });
      } catch (err) {
        const detail = unconfirmedFrom(err);
        if (!detail) throw err;
        printUnconfirmed(detail, `hedge bind-submit ${submissionId} ${bindRequestId}${opts.producerEmail ? " --producer-email " + opts.producerEmail : ""}`, ctx.json);
        return;
      }
      if (ctx.json) return printJson(r);
      printBindRequest(r);
      process.stdout.write(`\nHedge is placing the bind. Track it with hedge bind-status ${submissionId} ${bindRequestId}; a bound event follows on the events feed and webhooks.\n`);
    });
}
