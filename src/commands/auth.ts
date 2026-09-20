import type { Command } from "commander";
import { loginInteractive, loginClientCredentials, clearToken, apiRequest, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const SCOPE = "broker_mcp broker_submit";

export function registerAuth(program: Command): void {
  program
    .command("login")
    .description("Sign in to your Hedge broker account (device code by default; --client-id for a machine credential)")
    .option("--browser", "use the browser (loopback) flow instead of a device code")
    .option(
      "--client-id <id>",
      "sign in with a brokerage machine credential (client_credentials grant) for scripts and automation; the client id (bac_...) from Settings → API keys. Pair with --client-secret",
    )
    .option(
      "--client-secret <secret>",
      "the machine credential's secret (bas_...). Prefer HEDGE_CLIENT_SECRET in the environment so the secret stays out of shell history",
    )
    .action(async (opts) => {
      const g = program.opts();
      const ctx = makeCtx(g);
      if (opts.clientId || opts.clientSecret) {
        if (opts.browser) throw new Error("--browser and --client-id are different sign-in modes; pass one");
        const clientId = String(opts.clientId ?? "").trim();
        const clientSecret = String(opts.clientSecret ?? process.env.HEDGE_CLIENT_SECRET ?? "").trim();
        if (!clientId) throw new Error("--client-id is required with --client-secret");
        if (!clientSecret) throw new Error("--client-secret (or HEDGE_CLIENT_SECRET) is required with --client-id");
        const r = await loginClientCredentials({
          cfg: ctx.cfg,
          metadataUrl: ctx.env.metadataUrl,
          clientId,
          clientSecret,
          scope: SCOPE,
        });
        // Never echo the secret. The token file is written 0600 and the
        // access token is renewed by re-exchange when it expires.
        process.stdout.write(
          `Signed in with machine credential ${clientId}` +
            (r.scope ? ` (scope: ${r.scope})` : "") +
            ".\nWrites made with this credential must name the producing broker: pass --producer-email on submit, intake, reply, answer-asks, withdraw and bind.\n",
        );
        return;
      }
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
