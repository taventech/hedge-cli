import { createServer } from "node:http";
import { createPkce, randomState } from "./pkce.js";

export interface AsMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  registration_endpoint?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** Fetch RFC 8414 AS metadata from the issuer's well-known document. */
export async function discover(metadataUrl: string): Promise<AsMetadata> {
  const res = await fetch(metadataUrl);
  if (!res.ok) throw new Error(`Could not load auth metadata (${res.status}) from ${metadataUrl}`);
  return (await res.json()) as AsMetadata;
}

/** RFC 7591 dynamic client registration → a public client_id. */
export async function registerClient(
  registrationEndpoint: string,
  clientName: string,
  redirectUris: string[],
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: redirectUris }),
  });
  if (!res.ok) throw new Error(`Client registration failed (${res.status})`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error("Registration returned no client_id");
  return body.client_id;
}

/**
 * Device Authorization Grant (RFC 8628). Prints the verification URL + code
 * via `onPrompt`, then polls until the user approves. Works headless/over SSH.
 */
export async function deviceLogin(opts: {
  meta: AsMetadata;
  clientId: string;
  scope?: string;
  onPrompt: (info: { verificationUri: string; verificationUriComplete?: string; userCode: string }) => void;
  openBrowser?: (url: string) => void;
}): Promise<TokenResponse> {
  const { meta, clientId } = opts;
  if (!meta.device_authorization_endpoint) throw new Error("This server doesn't support device login");
  const body = new URLSearchParams({ client_id: clientId });
  if (opts.scope) body.set("scope", opts.scope);
  const start = await fetch(meta.device_authorization_endpoint, { method: "POST", headers: FORM, body });
  if (!start.ok) throw new Error(`Device authorization failed (${start.status})`);
  const d = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };
  opts.onPrompt({
    verificationUri: d.verification_uri,
    verificationUriComplete: d.verification_uri_complete,
    userCode: d.user_code,
  });
  if (opts.openBrowser) opts.openBrowser(d.verification_uri_complete || d.verification_uri);

  let interval = (d.interval || 5) * 1000;
  const deadline = Date.now() + (d.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: FORM,
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: d.device_code,
        client_id: clientId,
      }),
    });
    const pb = (await poll.json()) as TokenResponse & { error?: string };
    if (poll.ok) return pb;
    if (pb.error === "authorization_pending") continue;
    if (pb.error === "slow_down") { interval += 5000; continue; }
    throw new Error(pb.error === "access_denied" ? "Access was denied" : (pb.error || `Login failed (${poll.status})`));
  }
  throw new Error("Login timed out. Run the command again");
}

/**
 * Authorization-code + PKCE with a loopback redirect (RFC 8252). Opens the
 * browser, catches the callback on an ephemeral localhost port. The fast path
 * on a machine with a browser.
 */
export async function loopbackLogin(opts: {
  meta: AsMetadata;
  clientId: string;
  scope?: string;
  openBrowser: (url: string) => void;
}): Promise<TokenResponse> {
  const { meta, clientId } = opts;
  const { verifier, challenge } = createPkce();
  const state = randomState();
  return new Promise<TokenResponse>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", `http://127.0.0.1`);
        if (!url.pathname.startsWith("/callback")) {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const gotState = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          "<html><body style='font-family:sans-serif;text-align:center;padding:3rem'>" +
            (err ? "You can close this tab." : "Signed in. You can close this tab and return to your terminal.") +
            "</body></html>",
        );
        server.close();
        if (err) return reject(new Error(err));
        if (!code || gotState !== state) return reject(new Error("Invalid callback"));
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const tr = await fetch(meta.token_endpoint, {
          method: "POST",
          headers: FORM,
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: redirectUri,
          }),
        });
        const tb = (await tr.json()) as TokenResponse & { error?: string };
        if (!tr.ok) return reject(new Error(tb.error || `Token exchange failed (${tr.status})`));
        resolve(tb);
      } catch (e) {
        reject(e as Error);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("Could not bind loopback port"));
      port = addr.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = new URL(meta.authorization_endpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);
      if (opts.scope) authUrl.searchParams.set("scope", opts.scope);
      opts.openBrowser(authUrl.toString());
    });
    let port = 0;
  });
}

/** Refresh an access token. */
export async function refresh(tokenEndpoint: string, clientId: string, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  const body = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok) throw new Error(body.error || `Token refresh failed (${res.status})`);
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
