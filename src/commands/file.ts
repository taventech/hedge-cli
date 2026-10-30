import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { ApiError, apiRequest, multipartRequest, table, printJson } from "../core/index.js";
import { makeCtx, type Ctx } from "../context.js";
import { fileIsBusy, listFlag, mergeAnswers, parseSets, readJsonFile, renderFileState } from "../render.js";

// The write half of the flow: create (or intake) a file, follow each
// market's state, answer what it needs, request quotes. Every call returns
// the same per-market file state.

const SET_HELP =
  "an answer, repeatable: key=value answers a canonical key for every market that asks it; <program_id>:<id>=value answers one market's own question. Numbers and true/false are typed; key:=<json> sends exact JSON";

function minutes(value: unknown): number {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) throw new Error("--timeout expects a whole number of minutes");
  return n;
}

const statusPath = (id: string) => `/broker/submissions/${id}/instant-quotes`;

// Poll the file state every 5 s while any market is preparing or quoting.
async function waitSettled(ctx: Ctx, id: string, timeoutMin: number, first?: any): Promise<any> {
  let fs = first ?? (await apiRequest<any>(ctx.client, "GET", statusPath(id)));
  const deadline = Date.now() + timeoutMin * 60_000;
  if (!fileIsBusy(fs)) return fs;
  if (!ctx.json) process.stderr.write("Waiting for the markets");
  while (fileIsBusy(fs) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    if (!ctx.json) process.stderr.write(".");
    fs = await apiRequest<any>(ctx.client, "GET", statusPath(id));
  }
  if (!ctx.json) process.stderr.write(fileIsBusy(fs) ? ` still working after ${timeoutMin} min\n` : "\n");
  return fs;
}

function show(ctx: Ctx, fs: any): void {
  if (ctx.json) printJson(fs);
  else process.stdout.write(renderFileState(fs) + "\n");
}

export function registerFile(program: Command): void {
  program
    .command("create")
    .alias("submit")
    .summary("Create a file for the instant markets (flags or --file)")
    .description(
      "Create a file for the Hedge Instant Quote markets from flags or a JSON body. Returns each market's state and what it still needs. Refused with no_instant_market (and where to email it) when no instant market fits",
    )
    .option("--insured <name>", "legal business name (applicant.insured_name)")
    .option("--narrative <text>", "what the business does")
    .option("--lines <slugs>", "comma-separated lines of coverage, e.g. gl,property")
    .option("--state <ST>", "risk state (2-letter); with address flags it is the mailing address state")
    .option("--effective <date>", "requested effective date, YYYY-MM-DD")
    .option("--naics <code>", "6-digit NAICS")
    .option("--website <url>", "insured website")
    .option("--fein <id>", "FEIN (or SSN for a sole proprietor)")
    .option("--entity-type <type>", "legal entity type, e.g. llc, corporation")
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
    .option("--programs <ids>", "comma-separated program ids from hedge appetite (default: every instant market that fits)")
    .option("--set <answer...>", SET_HELP)
    .option("--client-reference <ref>", "your reference (up to 128 chars, unique per brokerage): re-sending it returns the existing file instead of a new one")
    .option("--quote", "quote every market as soon as it is ready, now or after later answers")
    .option("--file <path|->", "the full JSON request body from a file, or - for stdin. Flags win over the body's fields")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .option("--idempotency-key <key>", "Idempotency-Key header (default: a random UUID per run)")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, any> = opts.file ? readJsonFile(opts.file, "--file") : {};

      const applicant: Record<string, unknown> = {};
      const flagMap: [string, string][] = [
        ["insured", "insured_name"], ["naics", "naics"], ["website", "website"], ["fein", "fein_or_ssn"],
        ["entityType", "entity_type"], ["businessPhone", "business_phone"], ["businessEmail", "business_email"],
        ["contactFirst", "contact_first_name"], ["contactLast", "contact_last_name"],
        ["contactEmail", "contact_email"], ["contactPhone", "contact_phone"],
      ];
      for (const [flag, field] of flagMap) if (opts[flag]) applicant[field] = opts[flag];

      const bodyApplicant = body.applicant && typeof body.applicant === "object" && !Array.isArray(body.applicant) ? body.applicant : undefined;
      const bodyAddress = bodyApplicant?.mailing_address && typeof bodyApplicant.mailing_address === "object" ? bodyApplicant.mailing_address : undefined;
      const addressFlags: Record<string, unknown> = {};
      if (opts.address) addressFlags.line1 = opts.address;
      if (opts.address2) addressFlags.line2 = opts.address2;
      if (opts.city) addressFlags.city = opts.city;
      if (opts.zip) addressFlags.zip = opts.zip;
      const hasAddressFlags = Object.keys(addressFlags).length > 0;
      const state = opts.state ? String(opts.state).trim().toUpperCase() : undefined;

      // Address flags merge into the body's mailing_address, so --file plus
      // one corrected field keeps the rest of the address.
      let mailing: Record<string, unknown> | undefined = bodyAddress ? { ...bodyAddress } : undefined;
      if (hasAddressFlags) mailing = { ...(mailing ?? {}), ...addressFlags };
      if (state) {
        body.primary_state = state;
        if (mailing) mailing.state = state;
      }
      if (hasAddressFlags) {
        const flagFor: Record<string, string> = { line1: "--address", city: "--city", state: "--state", zip: "--zip" };
        const missing = Object.keys(flagFor).filter((k) => !mailing?.[k]).map((k) => flagFor[k]);
        if (missing.length) throw new Error("--address, --city, --state and --zip go together (missing " + missing.join(", ") + ")");
      }
      if (mailing && (hasAddressFlags || state)) applicant.mailing_address = mailing;
      if (Object.keys(applicant).length) body.applicant = { ...(bodyApplicant ?? {}), ...applicant };

      if (opts.narrative) body.narrative = opts.narrative;
      if (opts.lines) body.lines_of_business = listFlag(opts.lines);
      if (opts.effective) body.effective_date = opts.effective;
      if (opts.programs) body.program_ids = listFlag(opts.programs);
      if (opts.clientReference) body.client_reference = opts.clientReference;
      if (opts.quote) body.quote = true;
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      mergeAnswers(body, parseSets(opts.set));

      if (!body.applicant?.insured_name) throw new Error("--insured is required (or applicant.insured_name in --file)");
      if (!body.narrative) throw new Error("--narrative is required (or narrative in --file)");
      if (!body.lines_of_business?.length) throw new Error("--lines is required (or lines_of_business in --file)");
      if (!body.primary_state && !body.applicant?.mailing_address?.state) throw new Error("--state is required (or primary_state in --file)");

      const res = await apiRequest<any>(ctx.client, "POST", "/broker/submissions", {
        body,
        headers: { "Idempotency-Key": opts.idempotencyKey ?? randomUUID() },
      });
      show(ctx, res);
    });

  program
    .command("intake [files...]")
    .summary("Create a file from documents and/or text")
    .description(
      "Create a file from documents and/or text (ACORDs, loss runs, an email): Hedge reads them, prefills the instant markets' applications and returns each market's state, like hedge create",
    )
    .option("--text <text>", "the risk as you would describe it in an email")
    .option("--text-file <path|->", "read the text from a file, or - for stdin")
    .option("--insured <name>", "insured business name")
    .option("--lines <slugs>", "comma-separated lines of coverage, e.g. gl,property")
    .option("--state <ST>", "risk state, 2-letter")
    .option("--effective <date>", "requested effective date, YYYY-MM-DD")
    .option("--programs <ids>", "comma-separated program ids from hedge appetite")
    .option("--client-reference <ref>", "your reference (unique per brokerage; re-sending it returns the existing file)")
    .option("--quote", "quote every market as soon as it is ready")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .option("--idempotency-key <key>", "Idempotency-Key header (default: a random UUID per run)")
    .action(async (files: string[], opts) => {
      const ctx = makeCtx(program.opts());
      if (opts.text && opts.textFile) throw new Error("pass --text or --text-file, not both");
      const text: string | undefined = opts.textFile ? (opts.textFile === "-" ? readFileSync(0, "utf8") : readFileSync(opts.textFile, "utf8")) : opts.text;
      if (!text?.trim() && !files.length) throw new Error("send documents, --text or --text-file");
      if (files.length > 20) throw new Error(`up to 20 files per intake (got ${files.length})`);

      const form = new FormData();
      if (text?.trim()) form.append("text", text);
      let total = 0;
      for (const f of files) {
        const bytes = readFileSync(f);
        if (bytes.byteLength > 15 * 1024 * 1024) throw new Error(`${f} is over the 15 MB per-file limit`);
        total += bytes.byteLength;
        form.append("files", new Blob([bytes], { type: "application/pdf" }), basename(f));
      }
      if (total > 60 * 1024 * 1024) throw new Error("the files are over the 60 MB total limit");
      if (opts.insured) form.append("insured_name", opts.insured);
      if (opts.effective) form.append("effective_date", opts.effective);
      if (opts.lines) form.append("lines_of_business", listFlag(opts.lines).join(","));
      if (opts.state) form.append("primary_state", String(opts.state).trim().toUpperCase());
      if (opts.programs) form.append("program_ids", listFlag(opts.programs).join(","));
      if (opts.clientReference) form.append("client_reference", opts.clientReference);
      if (opts.quote) form.append("quote", "true");
      if (opts.producerEmail) form.append("producer_email", opts.producerEmail);

      const res = await multipartRequest<any>(ctx.client, "POST", "/broker/intake", form, {
        "Idempotency-Key": opts.idempotencyKey ?? randomUUID(),
      });
      show(ctx, res);
    });

  program
    .command("status <submissionId>")
    .summary("Each market's state and what it needs (--wait polls)")
    .description("Each market's state on a file (preparing, needs answers, ready, quoting, quoted, declined, not a fit) and what it still needs")
    .option("--wait", "poll every 5 seconds until no market is preparing or quoting")
    .option("--timeout <minutes>", "how long --wait polls", "10")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const fs = opts.wait
        ? await waitSettled(ctx, submissionId, minutes(opts.timeout))
        : await apiRequest<any>(ctx.client, "GET", statusPath(submissionId));
      show(ctx, fs);
    });

  program
    .command("business <submissionId>")
    .summary("Correct the business: name, address, contact, class, effective date")
    .description(
      "Correct the file's core facts (PATCH /broker/submissions/{id}/business): the record changes, every market's copy follows and the markets re-prepare. Use it when hedge status says to set a core field",
    )
    .option("--insured <name>", "legal business name")
    .option("--address <line1>", "mailing address line 1 (with --city, --state and --zip)")
    .option("--address2 <line2>", "mailing address line 2")
    .option("--city <city>", "mailing address city")
    .option("--state <ST>", "mailing address state")
    .option("--zip <zip>", "mailing address ZIP code")
    .option("--contact-name <name>", "primary contact name")
    .option("--contact-email <email>", "primary contact email (the insured's, not the broker's)")
    .option("--contact-phone <phone>", "primary contact phone")
    .option("--effective <date>", "requested effective date, YYYY-MM-DD")
    .option("--naics <code>", "6-digit NAICS")
    .option("--description <text>", "what the business does (with --naics)")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, any> = {};
      if (opts.insured) body.insured_name = opts.insured;
      const address: Record<string, string> = {};
      if (opts.address) address.line1 = opts.address;
      if (opts.address2) address.line2 = opts.address2;
      if (opts.city) address.city = opts.city;
      if (opts.state) address.state = String(opts.state).trim().toUpperCase();
      if (opts.zip) address.zip = opts.zip;
      if (Object.keys(address).length) {
        const missing = ["line1", "city", "state", "zip"].filter((k) => !address[k]);
        if (missing.length) throw new Error("--address, --city, --state and --zip go together (missing " + missing.join(", ") + ")");
        body.mailing_address = address;
      }
      const contact: Record<string, string> = {};
      if (opts.contactName) contact.name = opts.contactName;
      if (opts.contactEmail) contact.email = opts.contactEmail;
      if (opts.contactPhone) contact.phone = opts.contactPhone;
      if (Object.keys(contact).length) body.contact = contact;
      if (opts.effective) body.effective_date = opts.effective;
      if (opts.description && !opts.naics) throw new Error("--description goes with --naics");
      if (opts.naics) body.classification = { naics: String(opts.naics).trim(), ...(opts.description ? { description: opts.description } : {}) };
      if (!Object.keys(body).length) throw new Error("nothing to change: pass at least one field");
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      const res = await apiRequest<any>(ctx.client, "PATCH", `/broker/submissions/${submissionId}/business`, { body });
      if (ctx.json) return printJson(res);
      process.stdout.write(`Updated. The markets re-prepare; follow them with: hedge status ${submissionId} --wait\n`);
    });

  program
    .command("answer <submissionId>")
    .summary("Answer what the markets need (--set key=value, --confirm-suggestions)")
    .description(
      "Answer what the markets still need, and confirm the values Hedge suggests (a class, for example). All or nothing: a refused answer saves none and says why",
    )
    .option("--set <answer...>", SET_HELP)
    .option("--confirm-suggestions", "confirm every value Hedge suggests as it stands (confirm_suggestions); answer one with --set to pick another")
    .option("--file <path|->", "a JSON body {shared_answers, answers, confirm_suggestions} from a file, or - for stdin; --set wins per key")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, any> = opts.file ? readJsonFile(opts.file, "--file") : {};
      mergeAnswers(body, parseSets(opts.set));
      if (opts.confirmSuggestions) body.confirm_suggestions = true;
      if (!Object.keys(body.shared_answers ?? {}).length && !Object.keys(body.answers ?? {}).length && body.confirm_suggestions !== true) {
        throw new Error("nothing to answer: pass --set key=value or --confirm-suggestions (see hedge status for what is missing)");
      }
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      const res = await apiRequest<any>(ctx.client, "PATCH", `/broker/submissions/${submissionId}/answers`, { body });
      show(ctx, res);
    });

  program
    .command("quote <submissionId>")
    .summary("Request quotes from the ready markets")
    .description("Request quotes from the markets that are ready (default: every market on the file). A market that still needs answers says what")
    .option("--programs <ids>", "comma-separated program ids to quote")
    .option("--wait", "then poll until no market is quoting")
    .option("--timeout <minutes>", "how long --wait polls", "10")
    .option("--producer-email <email>", "the producing broker (required with an API key)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const body: Record<string, unknown> = {};
      if (opts.programs) body.program_ids = listFlag(opts.programs);
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      let res: any;
      let refused = false;
      try {
        res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/quote`, { body });
      } catch (err) {
        // 409 when no market could be requested: the same body, per market.
        const b = err instanceof ApiError && err.status === 409 ? (err.body as any) : null;
        res = b?.results ? b : b?.detail?.results ? b.detail : null;
        if (!res) throw err;
        refused = true;
      }
      if (opts.wait && !refused) res = { ...(await waitSettled(ctx, submissionId, minutes(opts.timeout))), results: res.results };
      if (refused) process.exitCode = 1;
      if (ctx.json) return printJson(res);
      const names = new Map<string, string>((res.markets ?? []).map((m: any) => [String(m.program_id), `${m.market} / ${m.program}`]));
      process.stdout.write(
        table(
          (res.results ?? []).map((r: any) => ({
            market: names.get(String(r.program_id)) ?? r.program_id,
            outcome: r.outcome,
            detail: r.reason ?? (r.missing?.length ? `${r.missing.length} answer(s) missing: ${r.missing.map((m: any) => m.label ?? m.key).join("; ")}` : ""),
          })),
          ["market", "outcome", "detail"],
        ) + "\n\n",
      );
      if (res.submission_id) process.stdout.write(renderFileState(res) + "\n");
    });
}
