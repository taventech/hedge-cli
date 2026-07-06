import type { CliConfig, ClientOptions } from "./core/index.js";

export interface Env {
  metadataUrl: string;
  apiBase: string;
  brokerPortalBase: string;
}

// prod vs staging endpoints. --staging (or HEDGE_ENV=staging) flips them.
export function resolveEnv(staging: boolean): Env {
  if (staging || process.env.HEDGE_ENV === "staging") {
    return {
      metadataUrl: "https://staging-api.hedgespecialty.com/.well-known/oauth-authorization-server",
      apiBase: "https://staging-api.hedgespecialty.com/api/v1",
      brokerPortalBase: "https://staging-brokers.hedgespecialty.com",
    };
  }
  return {
    metadataUrl: "https://api.hedgespecialty.com/.well-known/oauth-authorization-server",
    apiBase: "https://api.hedgespecialty.com/api/v1",
    brokerPortalBase: "https://brokers.hedgespecialty.com",
  };
}

export interface Ctx {
  env: Env;
  cfg: CliConfig;
  client: ClientOptions;
  json: boolean;
}

export function makeCtx(opts: { staging?: boolean; json?: boolean }): Ctx {
  const env = resolveEnv(!!opts.staging);
  const cfg: CliConfig = { appName: "hedge", profile: opts.staging ? "staging" : "prod" };
  return { env, cfg, client: { cfg, apiBase: env.apiBase }, json: !!opts.json };
}
