import type { Command } from "commander";
import { loginInteractive, clearToken, apiRequest, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const SCOPE = "broker_mcp broker_submit";

export function registerAuth(program: Command): void {
  program
    .command("login")
    .description("Sign in to your Hedge broker account")
    .option("--browser", "use the browser (loopback) flow instead of a device code")
    .action(async (opts) => {
      const g = program.opts();
      const ctx = makeCtx(g);
      await loginInteractive({
        cfg: ctx.cfg,
        metadataUrl: ctx.env.metadataUrl,
        clientName: "Hedge CLI",
        scope: SCOPE,
        mode: opts.browser ? "browser" : "device",
        log: (m) => process.stdout.write(m + "\n"),
      });
      process.stdout.write("\nSigned in.\n");
    });

  program
    .command("logout")
    .description("Remove stored credentials")
    .action(() => {
      const ctx = makeCtx(program.opts());
      clearToken(ctx.cfg);
      process.stdout.write("Signed out.\n");
    });

  program
    .command("whoami")
    .description("Show the signed-in broker + brokerage")
    .action(async () => {
      const ctx = makeCtx(program.opts());
      const me = await apiRequest<Record<string, unknown>>(ctx.client, "GET", "/broker/me");
      if (ctx.json) return printJson(me);
      const b = (me.brokerage ?? {}) as Record<string, unknown>;
      process.stdout.write(
        kv({
          email: me.email,
          name: me.full_name,
          brokerage: b.name,
          role: me.role,
        }) + "\n",
      );
    });
}
