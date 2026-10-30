import type { Command } from "commander";

// Commands 0.5 removed with the move to the instant-quote flow. Each still
// parses (hidden from help) and says what replaced it, so an old script
// fails with a pointer instead of "unknown command".
const REMOVED: [string, string][] = [
  ["markets", "hedge status <id> shows each market's state"],
  ["finalize", "hedge quote <id> requests quotes (an API file never waits for a release)"],
  ["answer-asks", "hedge answer <id> --set key=value"],
  ["request-quote", "hedge quote <id>"],
  ["thread", "follow a file with hedge status <id> and hedge events"],
  ["reply", "answer what a market needs with hedge answer <id> --set key=value"],
  ["bind", "hedge bind-link <id> <quoteId>"],
  ["bind-status", "hedge bind-link <id> <quoteId>; bind progress arrives on hedge events"],
  ["bind-upload", "hedge bind-link <id> <quoteId> (the bind checklist takes the documents)"],
  ["bind-submit", "hedge bind-link <id> <quoteId>"],
  ["programs", "hedge appetite --state ST --lines ..."],
  ["program-schema", "hedge requirements --programs <id> --state ST --lines ..."],
  ["market-requirements", "hedge requirements --state ST --lines ..."],
];

export function registerRemoved(program: Command): void {
  for (const [name, use] of REMOVED) {
    program
      .command(name, { hidden: true })
      .argument("[args...]")
      .allowUnknownOption()
      .action(() => {
        throw new Error(`hedge ${name} was removed in 0.5. Use: ${use}`);
      });
  }
}
