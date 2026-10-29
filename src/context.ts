import type { CliConfig, ClientOptions } from "./core/index.js";
import { VERSION } from "./version.js";

export interface Env {
  name: "prod" | "sandbox" | "staging" | "local";
  metadataUrl: string;
  apiBase: string;
  brokerPortalBase: string;
}

function hosted(name: Env["name"], apiHost: string, portal: string): Env {
  return {
    name,
    metadataUrl: `${apiHost}/.well-known/oauth-authorization-server`,
    apiBase: `${apiHost}/api/v1`,
    brokerPortalBase: portal,
  };
}

// prod by default. --sandbox (or HEDGE_ENV=sandbox) is the place to build
// against: Hedge's staging environment behind the sandbox hostname, with
// carrier test systems only. --staging (HEDGE_ENV=staging) is the same
// environment on its internal hostname, kept for Hedge's own use.
export function resolveEnv(opts: { sandbox?: boolean; staging?: boolean }): Env {
  // HEDGE_API_URL points the CLI at a local API (development and tests).
  const local = process.env.HEDGE_API_URL?.replace(/\/$/, "");
  if (local) return hosted("local", local, local);
  const fromEnv = process.env.HEDGE_ENV;
  if (opts.sandbox || (!opts.staging && fromEnv === "sandbox")) {
    return hosted("sandbox", "https://sandbox-api.hedgespecialty.com", "https://staging-brokers.hedgespecialty.com");
  }
  if (opts.staging || fromEnv === "staging") {
    return hosted("staging", "https://staging-api.hedgespecialty.com", "https://staging-brokers.hedgespecialty.com");
  }
  return hosted("prod", "https://api.hedgespecialty.com", "https://brokers.hedgespecialty.com");
}

export interface Ctx {
  env: Env;
  cfg: CliConfig;
  client: ClientOptions;
  json: boolean;
}

export function makeCtx(opts: { sandbox?: boolean; staging?: boolean; json?: boolean }): Ctx {
  const env = resolveEnv(opts);
  // One stored credential per environment: sandbox keys never work on prod.
  const cfg: CliConfig = { appName: "hedge", profile: env.name };
  return {
    env,
    cfg,
    client: { cfg, apiBase: env.apiBase, headers: { "Hedge-Client": `hedge-cli/${VERSION}` } },
    json: !!opts.json,
  };
}
