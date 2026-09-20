import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { apiRequest, multipartRequest, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

// The three Hedge market categories, in the order the API always returns them.
export const CATEGORY_ORDER = ["instant_quote", "binding", "specialty"] as const;
export const CATEGORY_LABELS: Record<string, string> = {
  instant_quote: "Hedge Instant Quote",
  binding: "Hedge Binding",
  specialty: "Hedge Specialty",
};

// What to run next after a create (submit or intake), keyed on the response's
// marketing_status: the run started (poll markets) or the draft is held.
export function nextAfterCreate(submissionId: string, marketingStatus: unknown): string {
  if (marketingStatus === "awaiting_finalization") {
    return (
      `Held. Attach documents (hedge upload ${submissionId} <file.pdf>), check hedge requirements ${submissionId}, ` +
      `then release it with hedge finalize ${submissionId}`
    );
  }
  return (
    `The run started: Hedge is matching appetite and will email the producer the clearance.\n` +
    `Next: hedge markets ${submissionId}  (matching usually lands within ~5 minutes; add --wait to poll)\n` +
    `      hedge thread ${submissionId}   (the conversation with Hedge)`
  );
}

export function printWarnings(warnings: unknown): void {
  if (Array.isArray(warnings) && warnings.length) {
    process.stdout.write("\nWarnings:\n" + warnings.map((w) => "  - " + String(w)).join("\n") + "\n");
  }
}

function readTextSource(source: string): string {
  return source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
}

function fmtAssumption(a: any): string {
  const mark = a.confirmed ? "[x]" : "[ ]";
  const value = a.value === undefined || a.value === null ? "" : ` = ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`;
  return `${mark} ${a.key}: ${a.label ?? ""}${value}`;
}

// Human rendering of GET /broker/submissions/{id}/markets: one block per
// category (always all three), a table of lanes, then the per-lane detail
// lines (asks, assumptions, quotes) the table cannot hold.
export function renderMarkets(view: any): string {
  const out: string[] = [];
  for (const group of view.categories ?? []) {
    const label = group.label ?? CATEGORY_LABELS[group.category] ?? group.category;
    out.push(`${label} (${group.category})${group.description ? " - " + group.description : ""}`);
    const lanes: any[] = group.lanes ?? [];
    if (!lanes.length) {
      out.push("  (no lanes)");
      out.push("");
      continue;
    }
    const rows = lanes.map((l) => ({
      lane: l.lane_id,
      market: l.market_name ?? "",
      program: l.program ?? "",
      lines: (l.lines || []).join(","),
      status: l.status_label ?? l.status,
      ready: l.submit_ready ? "yes" : "no",
      quote: (l.quotes || []).map((q: any) => q.premium).join(" / "),
      bound: l.bound ? "yes" : "",
    }));
    out.push(table(rows, ["lane", "market", "program", "lines", "status", "ready", "quote", "bound"]).split("\n").map((x) => "  " + x).join("\n"));
    for (const l of lanes) {
      const detail: string[] = [];
      if (l.needs_from_you?.length) detail.push("    needs from you: " + l.needs_from_you.join("; "));
      if (l.assumptions?.length) {
        detail.push("    assumptions (pre-bind attestations; [ ] = still to confirm):");
        for (const a of l.assumptions) detail.push("      " + fmtAssumption(a));
      }
      if (l.quotes?.length) {
        for (const q of l.quotes) {
          detail.push(`    quote ${q.quote_id}: ${q.premium}${q.lines?.length ? " (" + q.lines.join(", ") + ")" : ""}${q.is_revision ? " [revision]" : ""}`);
        }
      }
      if (detail.length) out.push(`  ${l.market_name ?? l.lane_id}${l.program ? " / " + l.program : ""}:\n` + detail.join("\n"));
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function laneCount(view: any): number {
  return (view?.categories ?? []).reduce((n: number, g: any) => n + (g.lanes?.length ?? 0), 0);
}

export function registerIntake(program: Command): void {
  program
    .command("intake [files...]")
    .description(
      "Send Hedge a risk the way you would email it: free text and/or PDFs (ACORDs, loss runs, supplements). Creates the submission and STARTS the run unless --hold. Hedge reads the insured out of the text when --insured is omitted",
    )
    .option("--text <text>", "the risk as you would describe it in an email (required unless --insured or --text-file)")
    .option("--text-file <path|->", "read the text from a file, or - for stdin")
    .option("--insured <name>", "insured business name (skips the extractor for the name)")
    .option("--lob <slugs>", "comma-separated lines of business: canonical slugs or common aliases, e.g. gl,property")
    .option("--state <ST>", "primary risk state, 2-letter")
    .option("--effective <date>", "effective date, YYYY-MM-DD")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .option("--hold", "keep the draft; release it later with hedge finalize <id>")
    .option(
      "--idempotency-key <key>",
      "Idempotency-Key header value (default: a random UUID per invocation). Re-send the same key to replay the saved submission instead of creating a duplicate",
    )
    .action(async (files: string[], opts) => {
      const ctx = makeCtx(program.opts());
      if (opts.text && opts.textFile) throw new Error("pass --text or --text-file, not both");
      const text: string | undefined = opts.textFile ? readTextSource(opts.textFile) : opts.text;
      if (!text?.trim() && !opts.insured) throw new Error("--text (or --text-file) or --insured is required");
      if (files.length > 20) throw new Error(`up to 20 files per intake (got ${files.length})`);

      const form = new FormData();
      if (text?.trim()) form.append("text", text);
      for (const f of files) {
        const bytes = readFileSync(f);
        if (bytes.byteLength > 15 * 1024 * 1024) throw new Error(`${f} is over the 15 MB per-file limit`);
        form.append("files", new Blob([bytes], { type: "application/pdf" }), basename(f));
      }
      if (opts.insured) form.append("insured_name", opts.insured);
      if (opts.effective) form.append("effective_date", opts.effective);
      if (opts.lob) form.append("lines_of_business", String(opts.lob).split(",").map((s: string) => s.trim()).filter(Boolean).join(","));
      if (opts.state) form.append("primary_state", String(opts.state).trim().toUpperCase());
      if (opts.producerEmail) form.append("producer_email", opts.producerEmail);
      if (opts.hold) form.append("hold", "true");

      const res = await multipartRequest<Record<string, any>>(ctx.client, "POST", "/broker/intake", form, {
        "Idempotency-Key": opts.idempotencyKey ?? randomUUID(),
      });
      if (ctx.json) return printJson(res);
      const applicant = res.applicant ?? {};
      process.stdout.write(kv({
        submission_id: res.submission_id,
        insured: applicant.insured_name ?? "",
        status: res.status_label,
        marketing: res.marketing_status,
        documents: (res.documents || []).map((d: any) => d.display_name).join(", "),
        portal: res.portal_url,
      }) + "\n");
      printWarnings(res.warnings);
      process.stdout.write("\n" + nextAfterCreate(String(res.submission_id), res.marketing_status) + "\n");
    });

  program
    .command("markets <submissionId>")
    .description("The markets being tried, in the three Hedge categories (Instant Quote, Binding, Specialty): status, what each lane needs from you, the assumptions Hedge made, released quotes")
    .option("--wait", "poll until at least one lane attaches (usually ~5 minutes after create)")
    .option("--timeout <minutes>", "how long --wait polls before giving up", "8")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const path = `/broker/submissions/${submissionId}/markets`;
      let view = await apiRequest<any>(ctx.client, "GET", path);
      if (opts.wait && laneCount(view) === 0) {
        const timeoutMin = Number.parseInt(String(opts.timeout), 10);
        if (!Number.isFinite(timeoutMin) || timeoutMin < 1) throw new Error("--timeout expects a whole number of minutes");
        const deadline = Date.now() + timeoutMin * 60_000;
        if (!ctx.json) process.stdout.write("Waiting for markets to match (usually ~5 minutes)");
        while (Date.now() < deadline && laneCount(view) === 0) {
          await new Promise((r) => setTimeout(r, 15_000));
          if (!ctx.json) process.stdout.write(".");
          view = await apiRequest<any>(ctx.client, "GET", path);
        }
        if (!ctx.json) process.stdout.write("\n");
      }
      if (ctx.json) return printJson(view);
      if (laneCount(view) === 0) {
        process.stdout.write(
          renderMarkets(view) +
            "\n\nNo lanes yet. Matching usually lands within ~5 minutes of create; an empty view during matching is not \"no appetite\". " +
            `If the submission is held, release it with hedge finalize ${submissionId}.\n`,
        );
        return;
      }
      process.stdout.write(renderMarkets(view) + "\n");
      process.stdout.write(`\nBind a released quote: hedge bind ${submissionId} --quote <quoteId>   Reply to Hedge: hedge reply ${submissionId} "..."\n`);
    });

  program
    .command("answer-asks <submissionId>")
    .description("Answer the outstanding items the matched markets still need, in one batch (keys from the list this prints when run without --set)")
    .option("--set <kv...>", "key=value pairs; values are typed per the item's input (number, bool, select option)")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const view = await apiRequest<any>(ctx.client, "GET", `/broker/submissions/${submissionId}/outstanding-requirements`);
      const items: any[] = view.items ?? [];
      if (!opts.set?.length) {
        if (ctx.json) return printJson(view);
        if (!items.length) {
          process.stdout.write("Nothing outstanding for the matched markets.\n");
          return;
        }
        process.stdout.write(table(items.map((i) => ({
          key: i.key, label: i.label, input: i.input ?? "", options: (i.options || []).map((o: any) => o.value).join("|"), markets: (i.markets || []).join("; "),
        })), ["key", "label", "input", "options", "markets"]) + "\n");
        process.stdout.write(`\nAnswer with: hedge answer-asks ${submissionId} --set key=value --set key2=value2\n`);
        return;
      }
      const inputs = new Map<string, string>(items.map((i) => [String(i.key), String(i.input ?? "")]));
      const answers: { key: string; value: unknown }[] = [];
      for (const pair of opts.set as string[]) {
        const i = String(pair).indexOf("=");
        if (i <= 0) throw new Error(`--set expects key=value, got "${pair}"`);
        const key = String(pair).slice(0, i);
        const raw = String(pair).slice(i + 1);
        const input = inputs.get(key) ?? "";
        let value: unknown = raw;
        if (/^(number|integer|currency|percent)$/i.test(input)) {
          const n = Number(raw.replace(/[,$%\s]/g, ""));
          if (!Number.isFinite(n)) throw new Error(`${key} expects a number, got "${raw}"`);
          value = n;
        } else if (/^(bool|boolean|checkbox|yes_no)$/i.test(input)) {
          if (/^(true|yes|y|1)$/i.test(raw)) value = true;
          else if (/^(false|no|n|0)$/i.test(raw)) value = false;
          else throw new Error(`${key} expects yes/no, got "${raw}"`);
        }
        answers.push({ key, value });
      }
      const body: Record<string, unknown> = { answers };
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/outstanding-requirements/answers`, { body });
      if (ctx.json) return printJson(res);
      process.stdout.write(`applied: ${(res.applied || []).join(", ") || "(none)"}\n`);
      for (const s of res.skipped || []) process.stdout.write(`skipped: ${s.key} - ${s.reason}\n`);
      if (res.routed) process.stdout.write(`routed to ${res.routed} carrier session(s)\n`);
    });

  program
    .command("withdraw <submissionId>")
    .description("Withdraw a submission: a held draft is deleted; a live placement is pulled from every engaged market and closed as withdrawn")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/withdraw`, {
        body: opts.producerEmail ? { producer_email: opts.producerEmail } : undefined,
      });
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ outcome: res.outcome, detail: res.detail }) + "\n");
    });
}
