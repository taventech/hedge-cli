import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { clearToken, loadToken, saveToken, type CliConfig, type StoredToken } from "./config.js";
import { refresh } from "./oauth.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ClientOptions {
  cfg: CliConfig;
  apiBase: string; // e.g. https://api.hedgespecialty.com/api/v1
  // A static credential (Bindly org API key) sent as a header instead of OAuth.
  apiKey?: string;
  apiKeyHeader?: string; // default "X-Api-Key"
}

// Returns a valid bearer, refreshing (and persisting) if within 60s of expiry.
async function bearer(cfg: CliConfig): Promise<string> {
  const tok = loadToken(cfg);
  if (!tok) throw new ApiError(401, "Not signed in. Run `login` first");
  if (tok.expires_at - 60 > Math.floor(Date.now() / 1000)) return tok.access_token;
  if (!tok.refresh_token) throw new ApiError(401, "Session expired. Run `login` again");
  try {
    const r = await refresh(tok.token_endpoint, tok.client_id, tok.refresh_token);
    const updated: StoredToken = {
      ...tok,
      access_token: r.access_token,
      refresh_token: r.refresh_token ?? tok.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600),
      scope: r.scope ?? tok.scope,
    };
    saveToken(cfg, updated);
    return updated.access_token;
  } catch {
    clearToken(cfg);
    throw new ApiError(401, "Session expired. Run `login` again");
  }
}

export async function apiRequest<T = unknown>(
  opts: ClientOptions,
  method: string,
  path: string,
  init?: { body?: unknown; headers?: Record<string, string>; query?: Record<string, string | undefined> },
): Promise<T> {
  const url = new URL(opts.apiBase.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(init?.query ?? {})) if (v != null) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json", ...(init?.headers ?? {}) };
  if (opts.apiKey) {
    headers[opts.apiKeyHeader ?? "X-Api-Key"] = opts.apiKey;
  } else {
    headers.Authorization = `Bearer ${await bearer(opts.cfg)}`;
  }
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const detail =
      (parsed && typeof parsed === "object" && "detail" in parsed && (parsed as { detail?: unknown }).detail) ||
      (parsed && typeof parsed === "object" && "error" in parsed && (parsed as { error?: unknown }).error) ||
      (typeof parsed === "string" ? parsed : `Request failed (${res.status})`);
    throw new ApiError(res.status, String(detail));
  }
  return parsed as T;
}

// Multipart upload (fetch sets the boundary; JSON path can't). Same auth as
// apiRequest — bearer (refreshing) or the static api key header.
export async function multipartRequest<T = unknown>(
  opts: ClientOptions,
  method: string,
  path: string,
  form: FormData,
): Promise<T> {
  const url = opts.apiBase.replace(/\/$/, "") + path;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.apiKey) headers[opts.apiKeyHeader ?? "X-Api-Key"] = opts.apiKey;
  else headers.Authorization = `Bearer ${await bearer(opts.cfg)}`;
  const res = await fetch(url, { method, headers, body: form });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text; // HTML error pages (502s from a proxy) are not JSON
    }
  }
  if (!res.ok) {
    const detail =
      (parsed && typeof parsed === "object" && "detail" in parsed && (parsed as any).detail) ||
      (typeof parsed === "string" && parsed.trim() ? parsed.trim() : `Upload failed (${res.status})`);
    throw new ApiError(res.status, String(detail));
  }
  return parsed as T;
}

// Pulls a usable filename out of a Content-Disposition header (RFC 5987
// filename* first, plain filename= second). Returns undefined when absent.
function dispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : undefined;
}

// Binary download with the same auth as apiRequest. Writes the response body
// to outPath; when outPath is omitted the server's Content-Disposition
// filename is used, then fallbackName. Returns the path written. Non-2xx
// responses throw ApiError with the parsed detail (JSON or raw text).
export async function downloadRequest(
  opts: ClientOptions,
  method: string,
  path: string,
  outPath?: string,
  fallbackName?: string,
): Promise<string> {
  const url = opts.apiBase.replace(/\/$/, "") + path;
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers[opts.apiKeyHeader ?? "X-Api-Key"] = opts.apiKey;
  else headers.Authorization = `Bearer ${await bearer(opts.cfg)}`;
  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const detail =
      (parsed && typeof parsed === "object" && "detail" in parsed && (parsed as { detail?: unknown }).detail) ||
      (typeof parsed === "string" && parsed.trim() ? parsed.trim() : `Download failed (${res.status})`);
    throw new ApiError(res.status, String(detail));
  }
  // basename() so a server-supplied filename can never escape the cwd.
  const serverName = dispositionFilename(res.headers.get("content-disposition"));
  const target = outPath ?? (serverName ? basename(serverName) : undefined) ?? fallbackName;
  if (!target) throw new ApiError(500, "No output filename (pass -o <file>)");
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return target;
}
