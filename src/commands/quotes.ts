import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Command } from "commander";
import { apiRequest, downloadRequest, sanitizeFilename, table, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";
import { cents } from "../render.js";

// Quotes and their PDFs, then the link to bind one.

function slug(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "market";
}

// <market>-<quote>-<name>.pdf, shell-friendly; the server's name is untrusted.
function docFileName(prefix: string, d: any): string {
  const name = d.file_name ? sanitizeFilename(String(d.file_name)) : "";
  const ext = (extname(name) || ".pdf").toLowerCase().replace(/[^.a-z0-9]/g, "");
  const stem = slug(name ? name.slice(0, name.length - extname(name).length) : d.kind ?? "document");
  return `${prefix}-${stem}${ext}`;
}

// path: a Hedge API route (sent with the token); url: a carrier-hosted https
// PDF (fetched without it).
interface Doc { path?: string; url?: string; name: string }

function hostedPdf(u: unknown): string | null {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && /\.pdf$/i.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

// Every stored PDF on the read: each quote's documents (Hedge's quote PDF
// first, then the carrier's) and each lane's carrier originals. Carrier-hosted
// links are listed, not fetched.
function collectDocs(res: any): { docs: Doc[]; links: string[]; pending: boolean } {
  const docs: Doc[] = [];
  const links: string[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  const add = (prefix: string, d: any) => {
    const remote = d.download_path ? null : hostedPdf(d.carrier_url);
    const key = d.download_path ?? remote;
    if (key && !seen.has(key)) {
      seen.add(key);
      // Two documents can share a name (same file_name or kind): number the
      // later ones so none overwrites another.
      const first = docFileName(prefix, d);
      const ext = extname(first);
      const stem = first.slice(0, first.length - ext.length);
      let name = first;
      for (let n = 2; names.has(name); n++) name = `${stem}-${n}${ext}`;
      names.add(name);
      docs.push(d.download_path ? { path: d.download_path, name } : { url: remote!, name });
    } else if (!key && d.carrier_url) {
      links.push(`${prefix}: ${d.carrier_url}`);
    }
  };
  let pending = false;
  for (const lane of res.lanes ?? []) {
    const market = slug(lane.market?.display_name);
    for (const q of lane.quotes ?? []) {
      // Hedge prepares its quote PDF on the first read after release.
      if (!(q.documents ?? []).some((d: any) => d.kind === "hedge_quote_pdf")) pending = true;
      for (const d of q.documents ?? []) add(`${market}-${String(q.quote_id).slice(0, 8)}`, d);
    }
    for (const d of lane.carrier_originals ?? []) add(`${market}-original`, d);
  }
  return { docs, links, pending };
}

async function fetchHostedPdf(url: string, target: string): Promise<string> {
  const res = await fetch(url);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${url} did not return a PDF (${res.status})`);
  writeFileSync(target, bytes);
  return target;
}

export function registerQuotes(program: Command): void {
  program
    .command("quotes <submissionId>")
    .summary("Itemized quotes; --download saves every PDF")
    .description("The quotes on a file, itemized: premium, total, whether it can be bound, its documents. --download saves every PDF")
    .option("--download [dir]", "save every quote PDF (Hedge's quote PDF and the carrier's, including carrier-hosted PDFs) into dir (default: current directory)")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "GET", `/broker/submissions/${submissionId}/quotes`);

      const saved: string[] = [];
      let links: string[] = [];
      let pending = false;
      if (opts.download) {
        const dir = typeof opts.download === "string" ? opts.download : ".";
        mkdirSync(dir, { recursive: true });
        const found = collectDocs(res);
        links = found.links;
        pending = found.pending;
        for (const d of found.docs) {
          const target = join(dir, d.name);
          saved.push(d.path ? await downloadRequest(ctx.client, "GET", d.path, target) : await fetchHostedPdf(d.url!, target));
        }
      }
      if (ctx.json) return printJson(opts.download ? { ...res, saved, carrier_links: links, hedge_quote_pdf_pending: pending } : res);

      const rows: Record<string, unknown>[] = [];
      for (const lane of res.lanes ?? []) {
        const market = lane.market?.display_name ?? "";
        if (!lane.quotes?.length) {
          rows.push({ market, program: lane.program_name ?? "", status: lane.status_label ?? lane.status });
          continue;
        }
        for (const q of lane.quotes) {
          rows.push({
            market,
            program: lane.program_name ?? q.program_name ?? "",
            status: lane.status_label ?? lane.status,
            quote_id: q.quote_id,
            premium: cents(q.pricing?.premium_cents),
            total: cents(q.pricing?.total_cents),
            bind: q.bind?.available ? "yes" : q.bind?.blocked_reason ?? "no",
            docs: (q.documents ?? []).length,
          });
        }
      }
      process.stdout.write(table(rows, ["market", "program", "status", "quote_id", "premium", "total", "bind", "docs"]) + "\n");
      if (opts.download) {
        process.stdout.write(`\nSaved ${saved.length} document(s):\n` + saved.map((p) => "  " + p).join("\n") + "\n");
        if (links.length) process.stdout.write("Carrier-hosted pages:\n" + links.map((l) => "  " + l).join("\n") + "\n");
        if (pending) process.stdout.write(`Hedge's quote PDF is being prepared; run this again in a few seconds to save it.\n`);
      } else if (rows.some((r) => r.quote_id)) {
        process.stdout.write(`\nSave the PDFs: hedge quotes ${submissionId} --download [dir]\nBind one:      hedge bind-link ${submissionId} <quote_id>\n`);
      }
    });

  program
    .command("bind-link <submissionId> <quoteId>")
    .summary("The link to bind a quote")
    .description(
      "Get the link to bind a quote: the broker's bind checklist in the Hedge portal (default), or with --for insured the insured's pay-and-bind page where the market supports it",
    )
    .option("--for <who>", "broker or insured", "broker")
    .option("--insured-email <email>", "--for insured: where Hedge emails the insured's link (required the first time)")
    .option("--attest", "--for insured: confirm every assumption Hedge made for the quote (only after the retail agent reviewed each one)")
    .option("--attest-keys <keys>", "--for insured: confirm only these assumption keys, comma-separated")
    .option("--producer-email <email>", "the producing broker the link signs in (required with an API key)")
    .action(async (submissionId, quoteId, opts) => {
      if (!["broker", "insured"].includes(opts.for)) throw new Error("--for must be broker or insured");
      if (opts.attest && opts.attestKeys) throw new Error("pass --attest or --attest-keys, not both");
      if ((opts.attest || opts.attestKeys || opts.insuredEmail) && opts.for !== "insured") throw new Error("--attest, --attest-keys and --insured-email go with --for insured");
      const ctx = makeCtx(program.opts());
      const body: Record<string, unknown> = { for: opts.for };
      if (opts.producerEmail) body.producer_email = opts.producerEmail;
      if (opts.insuredEmail) body.insured_email = opts.insuredEmail;
      if (opts.attest) body.attest_assumptions = true;
      if (opts.attestKeys) body.attest_assumptions = String(opts.attestKeys).split(",").map((s) => s.trim()).filter(Boolean);
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/quotes/${quoteId}/bind-link`, { body });
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ url: res.url, for: res.for, expires_at: res.expires_at ?? "" }) + "\n");
      if (res.for === "insured") {
        const emailed = res.emailed === true ? "Hedge emailed the link to the insured." : res.emailed === false ? "The email did not go out: share the link with the insured yourself." : "Hedge emailed this link earlier.";
        process.stdout.write("\n" + emailed + "\n");
      } else {
        process.stdout.write("\nThe link signs in to Hedge once, as the producing broker. Treat it like a password: open it yourself or give it only to that person.\n");
      }
    });
}
