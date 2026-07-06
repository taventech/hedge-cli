import type { Command } from "commander";
import { apiRequest, table, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

export function registerAppetite(program: Command): void {
  program
    .command("appetite <class>")
    .description('Which markets have appetite for a class, e.g. hedge appetite "roofing contractor" --state CA')
    .option("--state <ST>", "2-letter state")
    .option("--lob <slug>", "line of business filter")
    .action(async (klass, opts) => {
      const ctx = makeCtx(program.opts());
      const res = await apiRequest<any>(ctx.client, "GET", "/broker/appetite", {
        query: { q: klass, state: opts.state, lob: opts.lob },
      });
      if (ctx.json) return printJson(res);
      const rows = (res.results || []).map((m: any) => ({
        market: m.name,
        lines: (m.lines || []).map((l: any) => l.slug ?? l).join(","),
        programs: (m.matched_program_names || []).join("; "),
        turnaround: m.turnaround?.median_hours != null ? `${Math.round(m.turnaround.median_hours)}h median` : "",
      }));
      process.stdout.write(table(rows, ["market", "lines", "programs", "turnaround"]) + "\n");
    });
}
