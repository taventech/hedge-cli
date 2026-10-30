import type { Command } from "commander";
import { apiRequest, table, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

// The brokerage-wide change feed: one poll for every file.
export function registerEvents(program: Command): void {
  program
    .command("events")
    .summary("What changed across all your files")
    .description("What changed across all your brokerage's files (market attached, quote received, status changed, declined, bound...), oldest first. Follows next_cursor to the tail")
    .option("--since <cursor>", "start after this cursor (the last_cursor of an earlier run); omit to read from the beginning")
    .option("--limit <n>", "events per page, 1-100", "100")
    .option("--one-page", "read one page instead of following next_cursor to the tail")
    .action(async (opts) => {
      const ctx = makeCtx(program.opts());
      const events: any[] = [];
      let since: string | undefined = opts.since;
      let lastCursor: string | null = opts.since ?? null;
      let nextCursor: string | null = null;
      // The tail is a null next_cursor, never a short page. Stop if the
      // cursor stops moving so an empty page can't loop forever.
      for (;;) {
        const page = await apiRequest<any>(ctx.client, "GET", "/broker/events", { query: { since, limit: String(opts.limit) } });
        events.push(...(page.events ?? []));
        nextCursor = page.next_cursor ?? null;
        if (nextCursor) lastCursor = nextCursor;
        if (!nextCursor || opts.onePage || nextCursor === since) break;
        since = nextCursor;
      }
      if (ctx.json) return printJson({ events, next_cursor: nextCursor, last_cursor: lastCursor });
      if (!events.length) process.stdout.write("No new events.\n");
      else
        process.stdout.write(
          table(
            events.map((e) => ({
              when: String(e.occurred_at ?? "").replace("T", " ").slice(0, 16),
              submission: e.submission_id,
              type: e.type,
              market: e.market?.name ?? "",
              status: e.status_label ?? e.status ?? "",
              docs: e.documents?.length ? e.documents.length : "",
            })),
            ["when", "submission", "type", "market", "status", "docs"],
          ) + "\n",
        );
      if (lastCursor) process.stdout.write(`\nResume with: hedge events --since ${lastCursor}  (dedupe by event id)\n`);
    });
}
