#!/usr/bin/env node
import { Command } from "commander";
import { ApiError } from "./core/index.js";
import { registerAuth } from "./commands/auth.js";
import { registerSubmissions } from "./commands/submissions.js";
import { registerIntake } from "./commands/intake.js";
import { registerThread } from "./commands/thread.js";
import { registerBind } from "./commands/bind.js";
import { registerPrograms } from "./commands/programs.js";
import { registerAppetite } from "./commands/appetite.js";
import { registerQuotes } from "./commands/quotes.js";

const program = new Command();
program
  .name("hedge")
  .description("Send Hedge a risk from your terminal and track it to bind: intake, markets, thread, bind.")
  .version("0.4.0")
  .option("--staging", "use the staging environment")
  .option("--json", "output raw JSON (for scripting)");

registerAuth(program);
registerIntake(program);
registerSubmissions(program);
registerThread(program);
registerBind(program);
registerPrograms(program);
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
