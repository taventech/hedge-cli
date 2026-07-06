import { discover, deviceLogin, loopbackLogin, registerClient } from "./oauth.js";
import { openBrowser } from "./browser.js";
import { saveToken, type CliConfig } from "./config.js";

// One reusable "sign in and persist" flow for both CLIs. Prefers device-code
// (works everywhere incl. SSH); --browser forces the loopback path.
export async function loginInteractive(opts: {
  cfg: CliConfig;
  metadataUrl: string;
  clientName: string;
  scope?: string;
  mode?: "device" | "browser";
  staticClientId?: string; // skip DCR when a well-known client_id is provided
  log: (msg: string) => void;
}): Promise<void> {
  const meta = await discover(opts.metadataUrl);
  const mode = opts.mode ?? "device";
  // Both auth servers' DCR requires a non-empty redirect_uris, even for the
  // device flow (which never redirects). Register the loopback URIs in both
  // modes; the device grant simply ignores them.
  const redirectUris = ["http://127.0.0.1/callback", "http://localhost/callback"];
  const clientId =
    opts.staticClientId ??
    (meta.registration_endpoint
      ? await registerClient(meta.registration_endpoint, opts.clientName, redirectUris)
      : (() => {
          throw new Error("Server has no client registration; a client_id is required");
        })());

  const tr =
    mode === "browser"
      ? await loopbackLogin({ meta, clientId, scope: opts.scope, openBrowser })
      : await deviceLogin({
          meta,
          clientId,
          scope: opts.scope,
          openBrowser,
          onPrompt: (info) => {
            opts.log("");
            opts.log("  To connect, open:  " + info.verificationUri);
            opts.log("  and enter code:    " + info.userCode);
            if (info.verificationUriComplete)
              opts.log("  (or just open:     " + info.verificationUriComplete + ")");
            opts.log("");
            opts.log("Waiting for approval…");
          },
        });

  saveToken(opts.cfg, {
    access_token: tr.access_token,
    refresh_token: tr.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (tr.expires_in ?? 3600),
    scope: tr.scope,
    token_endpoint: meta.token_endpoint,
    client_id: clientId,
  });
}
