import type { Command } from "commander";
import { loginInteractive, loginClientCredentials, clearToken, loadToken, apiRequest, kv, printJson } from "../core/index.js";
import { makeCtx } from "../context.js";

const SCOPE = "broker_mcp broker_submit";

// Hedge grants broker_submit only when it has turned submit on for the
// brokerage; reads are self-serve. Say which one this sign-in got.
function accessNote(scope: string | undefined): string {
  if (scope && !scope.split(/\s+/).includes("broker_submit")) {
    return "Read-only: submit access is off for your brokerage. Hedge turns it on; request it in the portal under Settings → API keys.\n";
  }
  return "";
}

export function registerAuth(program: Command): void {
  program
    .command("login")
    .summary("Sign in (device code, browser, or an API key)")
    .description("Sign in to your Hedge broker account (device code by default; --client-id for an API key). Add --sandbox to sign in to the sandbox")
    .option("--browser", "use the browser (loopback) flow instead of a device code")
    .option(
      "--client-id <id>",
      "sign in with an API key (client_credentials grant) for scripts and agents: the client id (bac_...) from Settings → API keys. Pair with --client-secret",
    )
    .option(
      "--client-secret <secret>",
      "the API key's secret (bas_...). Prefer HEDGE_CLIENT_SECRET in the environment so the secret stays out of shell history",
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
          `Signed in to ${ctx.env.name} with API key ${clientId}` +
            (r.scope ? ` (scope: ${r.scope})` : "") +
            ".\nWrites made with an API key name the producing broker: pass --producer-email on create, intake, business, answer, quote, bind-link and withdraw.\n" +
            accessNote(r.scope),
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
      process.stdout.write(`\nSigned in to ${ctx.env.name}.\n` + accessNote(loadToken(ctx.cfg)?.scope));
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
      const scope = loadToken(ctx.cfg)?.scope ?? "";
      // An API key has no user: show only the fields the server returned.
      const rows = Object.fromEntries(
        Object.entries({ environment: ctx.env.name, email: me.email, name: me.full_name, brokerage: b.name, role: me.role, scope }).filter(
          ([, v]) => v != null && v !== "",
        ),
      );
      process.stdout.write(kv(rows) + "\n" + accessNote(scope));
    });
}
