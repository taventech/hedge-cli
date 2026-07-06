import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Stored credentials for one app+profile. The refresh token is the sensitive
// part; the file is written 0600 under the user's home. (OS keychain is a
// future enhancement; this interface is where it would slot in.)
export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch seconds
  scope?: string;
  token_endpoint: string;
  client_id: string;
  // Static credential mode (e.g. a Bindly org API key) instead of OAuth.
  // When set, callers send it as a header rather than refreshing a bearer.
  api_key?: string;
}

export interface CliConfig {
  appName: string; // "hedge" | "bindly"
  profile: string; // "prod" | "staging"
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "taven-cli");
}

function tokenPath(cfg: CliConfig): string {
  return join(configDir(), `${cfg.appName}.${cfg.profile}.json`);
}

export function saveToken(cfg: CliConfig, token: StoredToken): void {
  const p = tokenPath(cfg);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(p, 0o600);
}

export function loadToken(cfg: CliConfig): StoredToken | null {
  const p = tokenPath(cfg);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

export function clearToken(cfg: CliConfig): void {
  const p = tokenPath(cfg);
  if (existsSync(p)) rmSync(p);
}
