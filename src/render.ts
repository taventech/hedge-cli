import { readFileSync } from "node:fs";
import { ApiError, kv, table } from "./core/index.js";

// Shared parsing and rendering for the instant-quote flow: --set answers,
// the per-market file state every flow call returns, email_us, and errors.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function listFlag(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readJsonFile(source: string, flag: string): Record<string, any> {
  const raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${flag} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${flag} must be a JSON object`);
  return parsed as Record<string, any>;
}

// key=value types plain numbers and true/false (a digit string with a
// leading zero, like a ZIP, stays text); key:=<json> sends exact JSON.
function typed(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export interface AnswerSet {
  shared_answers: Record<string, unknown>;
  answers: Record<string, Record<string, unknown>>;
}

// --set key=value         -> shared_answers[key] (every market that asks it)
// --set <programId>:id=v  -> answers[programId][id] (that market only)
export function parseSets(pairs: string[] | undefined): AnswerSet {
  const out: AnswerSet = { shared_answers: {}, answers: {} };
  for (const pair of pairs ?? []) {
    const i = pair.indexOf("=");
    if (i <= 0) throw new Error(`--set expects key=value or key:=<json>, got "${pair}"`);
    let left = pair.slice(0, i);
    const raw = pair.slice(i + 1);
    let value: unknown;
    if (left.endsWith(":")) {
      left = left.slice(0, -1);
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`--set ${left}:= expects JSON, got ${raw}`);
      }
    } else {
      value = typed(raw);
    }
    const c = left.indexOf(":");
    if (c > 0 && UUID.test(left.slice(0, c))) {
      const programId = left.slice(0, c);
      const id = left.slice(c + 1);
      if (!id) throw new Error(`--set ${pair}: no question id after the program id`);
      (out.answers[programId] ??= {})[id] = value;
    } else {
      if (!left) throw new Error(`--set ${pair}: no key`);
      out.shared_answers[left] = value;
    }
  }
  return out;
}

// Merge --set answers over a body's own (flags win, per key).
export function mergeAnswers(body: Record<string, any>, sets: AnswerSet): void {
  if (Object.keys(sets.shared_answers).length) body.shared_answers = { ...(body.shared_answers ?? {}), ...sets.shared_answers };
  for (const [programId, answers] of Object.entries(sets.answers)) {
    body.answers = body.answers ?? {};
    body.answers[programId] = { ...(body.answers[programId] ?? {}), ...answers };
  }
}

export function dollars(n: unknown): string {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return "";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function cents(n: unknown): string {
  return n == null ? "" : dollars(Number(n) / 100);
}

// The --set target for a missing item: its canonical key when the question
// is bound to one (answers every market), else the market's own id.
function setTarget(programId: string, m: any): string | null {
  if (m.key && !String(m.key).startsWith("program.")) return String(m.key);
  if (m.id) return `${programId}:${m.id}`;
  return null;
}

export function renderEmailUs(e: any): string {
  const lines = ["Email it to Hedge instead:", `  to:       ${e?.address ?? ""}`];
  if (e?.subject) lines.push(`  subject:  ${e.subject}`);
  if (e?.what_to_include?.length) {
    lines.push("  include:");
    for (const item of e.what_to_include) lines.push(`    - ${item}`);
  }
  return lines.join("\n");
}

const BUSY = new Set(["preparing", "quoting"]);

export function fileIsBusy(fs: any): boolean {
  return (fs?.markets ?? []).some((m: any) => BUSY.has(m.state));
}

// FileState: returned by create, intake, status, answer and quote.
export function renderFileState(fs: any): string {
  const id = String(fs.submission_id ?? "");
  const out: string[] = [];
  const head: Record<string, unknown> = { submission: id };
  if (fs.client_reference) head.reference = fs.client_reference;
  head.portal = fs.portal_url ?? "";
  head.auto_quote = fs.automatic_quoting ? "on (each market quotes as soon as it is ready)" : "off";
  out.push(kv(head));
  const markets: any[] = fs.markets ?? [];
  out.push("");
  out.push(
    markets.length
      ? table(
          markets.map((m) => ({
            market: m.market ?? "",
            program: m.program ?? "",
            status: m.status_label ?? m.state,
            program_id: m.program_id,
          })),
          ["market", "program", "status", "program_id"],
        )
      : "(no markets)",
  );

  const gaps = markets.filter((m) => m.missing?.length);
  if (gaps.length) {
    out.push("", "Needs answers:");
    for (const m of gaps) {
      out.push(`  ${m.market}${m.program ? " / " + m.program : ""}`);
      for (const item of m.missing) {
        const target = setTarget(m.program_id, item);
        const what = `${item.label ?? item.key ?? item.id}${item.message ? ". " + item.message : ""}`;
        out.push(target ? `    --set ${target}=...   ${what}` : `    hedge business ${id} ...   ${what}`);
      }
    }
  }

  if (fs.suggested?.length) {
    out.push("", "Hedge suggests (confirm with the same value, or answer another):");
    for (const s of fs.suggested) {
      const value = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
      const target = s.program_id && s.id ? `${s.program_id}:${s.id}` : s.key;
      out.push(`  --set ${target}=${value}   ${s.label ?? ""}${s.value_label ? ": " + s.value_label : ""}`);
    }
  }
  if (fs.warnings?.length) {
    out.push("", "Warnings:", ...fs.warnings.map((w: unknown) => "  - " + String(w)));
  }

  const next: string[] = [];
  if (markets.some((m) => m.state === "preparing" || m.state === "quoting")) next.push(`hedge status ${id} --wait`);
  if (gaps.length || fs.suggested?.length) next.push(`hedge answer ${id} --set key=value ...`);
  if (gaps.some((m) => m.missing.some((item: any) => !setTarget(m.program_id, item)))) next.push(`hedge business ${id} ...  (core facts: name, address, contact, class, effective date)`);
  if (!fs.automatic_quoting && markets.some((m) => m.state === "ready")) next.push(`hedge quote ${id}`);
  if (markets.some((m) => m.state === "quoted")) next.push(`hedge quotes ${id} --download`, `hedge bind-link ${id} <quote_id>`);
  if (next.length) out.push("", "Next: " + next.join("\n      "));
  return out.join("\n");
}

// Human rendering of an API error, with the structured extras the flow
// returns (email_us, missing fields, refused answers, assumptions).
export function describeError(err: ApiError): string {
  const body = err.body as any;
  const detail = body && typeof body === "object" ? (body.detail ?? body) : undefined;
  const code = detail && typeof detail === "object" && typeof detail.code === "string" ? detail.code : "";
  const out = [`Error ${err.status}${code ? " " + code : ""}: ${err.message}`];
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    if (detail.email_us) out.push("", renderEmailUs(detail.email_us));
    if (Array.isArray(detail.fields) && detail.fields.length) out.push("", "Missing: " + detail.fields.join(", "));
    for (const list of [detail.errors, detail.missing]) {
      if (!Array.isArray(list) || !list.length) continue;
      out.push("");
      for (const e of list) out.push(`  ${e.program_id ? e.program_id + ":" : ""}${e.key ?? e.id ?? ""}: ${e.message ?? e.label ?? ""}`);
    }
    // An answer refused because it is a core fact of the file.
    if ((detail.errors ?? []).some((e: any) => /core field/i.test(String(e.message ?? "")))) {
      out.push("", "Core facts (name, mailing address, contact, class, effective date) are corrected with hedge business <id>; see hedge business --help.");
    }
    if (Array.isArray(detail.assumptions) && detail.assumptions.length) {
      out.push("", "Hedge quoted on these assumptions. The retail agent must confirm each one:");
      for (const a of detail.assumptions) {
        const v = a.value == null ? "" : ` = ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`;
        out.push(`  - ${a.key}: ${a.label ?? ""}${v}`);
      }
      out.push("Once confirmed, re-run with --attest (or --attest-keys k1,k2).");
    }
  }
  if (err.status === 403) {
    out.push("", "A 403 will not change on retry. Stop and have a person check access: submit access is turned on per brokerage by Hedge (request it in the portal under Settings → API keys).");
  } else if (err.status === 429) {
    out.push("", `Rate limited. Wait ${err.retryAfter ?? 60} seconds before the next call.`);
  } else if (err.status === 503 && err.retryAfter != null) {
    out.push("", `Try the same call once more after ${err.retryAfter} seconds.`);
  }
  return out.join("\n");
}
