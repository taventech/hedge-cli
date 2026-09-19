import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { apiRequest, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

function who(m: any): string {
  if (m.direction === "outbound") return "Hedge -> you";
  return "you -> Hedge";
}

function renderMessage(m: any): string {
  const when = String(m.occurred_at ?? "").replace("T", " ").slice(0, 16);
  const head = `-- ${when}  ${who(m)}  [${m.channel}/${m.kind}]${m.subject ? "  " + m.subject : ""}`;
  const lines = [head];
  if (m.from) lines.push(`   from: ${m.from}${m.to?.length ? "  to: " + m.to.join(", ") : ""}`);
  lines.push(String(m.body_text ?? "").trimEnd());
  if (m.attachments?.length) {
    lines.push("   attachments: " + m.attachments.map((a: any) => a.name + (a.download_path ? ` (${a.download_path})` : "")).join(", "));
  }
  return lines.join("\n");
}

export function registerThread(program: Command): void {
  program
    .command("thread <submissionId>")
    .description(
      "The conversation with Hedge on a submission, oldest first: the clearance email, questions, market-plan updates, quote deliveries, your replies. Follows next_cursor to the tail",
    )
    .option("--since <cursor>", "start strictly after this cursor (a next_cursor/last_cursor from an earlier run); omit to read from the beginning")
    .option("--limit <n>", "messages per page, 1-200", "50")
    .option("--one-page", "read a single page instead of following next_cursor to the tail")
    .action(async (submissionId, opts) => {
      const ctx = makeCtx(program.opts());
      const messages: any[] = [];
      let since: string | undefined = opts.since;
      let lastCursor: string | null = opts.since ?? null;
      let nextCursor: string | null = null;
      // The end-of-stream signal is a null next_cursor, never page length.
      for (;;) {
        const page = await apiRequest<any>(ctx.client, "GET", `/broker/submissions/${submissionId}/thread`, {
          query: { since, limit: String(opts.limit) },
        });
        messages.push(...(page.messages ?? []));
        nextCursor = page.next_cursor ?? null;
        if (nextCursor) lastCursor = nextCursor;
        if (!nextCursor || opts.onePage) break;
        since = nextCursor;
      }
      if (ctx.json) return printJson({ messages, next_cursor: nextCursor, last_cursor: lastCursor });
      if (!messages.length) {
        process.stdout.write("No messages yet. Hedge opens the thread with the clearance email once the run starts.\n");
        return;
      }
      process.stdout.write(messages.map(renderMessage).join("\n\n") + "\n");
      if (nextCursor) process.stdout.write(`\nMore may follow. Continue with: hedge thread ${submissionId} --since ${nextCursor}\n`);
      else if (lastCursor) process.stdout.write(`\nAt the tail. Resume later with: hedge thread ${submissionId} --since ${lastCursor}  (dedupe by id)\n`);
      process.stdout.write(`Reply with: hedge reply ${submissionId} "..."\n`);
    });

  program
    .command("reply <submissionId> <text>")
    .description("Reply to Hedge on a submission exactly as you would reply to its email: answer a question, send a revision, authorize a bind. Use - to read the message from stdin")
    .option("--attach <documentIds>", "comma-separated ids of documents already uploaded to this submission (hedge upload) to attach")
    .option("--producer-email <email>", "producing broker to attribute (required with a machine credential)")
    .option("--idempotency-key <key>", "Idempotency-Key header (default: a random UUID per invocation); a retry with the same key never sends the message twice")
    .action(async (submissionId, text, opts) => {
      const ctx = makeCtx(program.opts());
      const body = text === "-" ? readFileSync(0, "utf8") : String(text);
      if (!body.trim()) throw new Error("the reply is empty");
      if (body.length > 20000) throw new Error("the reply is over 20000 characters");
      const payload: Record<string, unknown> = { body };
      if (opts.attach) payload.document_ids = String(opts.attach).split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.producerEmail) payload.producer_email = opts.producerEmail;
      const res = await apiRequest<any>(ctx.client, "POST", `/broker/submissions/${submissionId}/thread`, {
        body: payload,
        headers: { "Idempotency-Key": opts.idempotencyKey ?? randomUUID() },
      });
      if (ctx.json) return printJson(res);
      process.stdout.write(kv({ message_id: res.message_id, status: res.status, detail: res.detail }) + "\n");
      process.stdout.write(`\nHedge answers on the thread, typically within a couple of minutes: hedge thread ${submissionId}\n`);
    });
}
