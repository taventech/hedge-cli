#!/usr/bin/env node
import { Command } from "commander";
import { ApiError } from "./core/index.js";
import { registerAuth } from "./commands/auth.js";
import { registerSubmissions } from "./commands/submissions.js";
import { registerAppetite } from "./commands/appetite.js";
import { registerQuotes } from "./commands/quotes.js";

const program = new Command();
program
  .name("hedge")
  .description("Submit risks to Hedge and track them from your terminal.")
  .version("0.2.0")
  .option("--staging", "use the staging environment")
  .option("--json", "output raw JSON (for scripting)");

registerAuth(program);
registerSubmissions(program);
registerAppetite(program);
registerQuotes(program);

program.hook("preAction", () => {
  // global flags are read per-command via program.opts()
});

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      process.stderr.write(`\n${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
main();
