#!/usr/bin/env node
import { Command, Option } from "commander";
import { ApiError, printJson } from "./core/index.js";
import { VERSION } from "./version.js";
import { describeError } from "./render.js";
import { registerAuth } from "./commands/auth.js";
import { registerFlow } from "./commands/flow.js";
import { registerFile } from "./commands/file.js";
import { registerQuotes } from "./commands/quotes.js";
import { registerEvents } from "./commands/events.js";
import { registerBook } from "./commands/book.js";
import { registerRemoved } from "./commands/removed.js";

const program = new Command();
program
  .name("hedge")
  .description(
    "Quote Hedge Instant Quote markets from your terminal: appetite, requirements, create, answer, quote, quotes and PDFs, bind link. Risks no instant market writes go to Hedge by email",
  )
  .version(VERSION)
  .option("--sandbox", "use the sandbox (sandbox-api.hedgespecialty.com): carrier test systems, nothing is bound")
  .addOption(new Option("--staging", "use Hedge's staging hostname").hideHelp())
  .option("--json", "print the raw JSON response (errors too, with exit code 1)");

registerAuth(program);
registerFlow(program);
registerFile(program);
registerQuotes(program);
registerEvents(program);
registerBook(program);
registerRemoved(program);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (program.opts().json && err instanceof ApiError) {
      const body = err.body && typeof err.body === "object" ? err.body : { detail: err.message };
      printJson({ status: err.status, ...(err.retryAfter != null ? { retry_after: err.retryAfter } : {}), ...body });
    } else if (err instanceof ApiError) {
      process.stderr.write(`\n${err.status === 401 ? err.message : describeError(err)}\n`);
    } else {
      // fetch() hides the reason (DNS, refused, TLS) in err.cause.
      const cause = (err as { cause?: { code?: string; hostname?: string } })?.cause;
      const why = cause?.code ? ` (${cause.code}${cause.hostname ? " " + cause.hostname : ""})` : "";
      process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}${why}\n`);
    }
    process.exit(1);
  }
}
main();
