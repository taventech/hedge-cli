import { writeFileSync } from "node:fs";
import { clearToken, loadToken, saveToken, type CliConfig, type StoredToken } from "./config.js";
import { clientCredentialsLogin, refresh } from "./oauth.js";

// `body` is the parsed response body (JSON when the server sent JSON), so a
// command can act on a structured error, e.g. the 409 `assumptions_unconfirmed`
// a bind request answers with the list of assumptions to attest.
export class ApiError extends Error {
  // retryAfter: seconds from a 429/503 Retry-After header, when sent.
  constructor(public status: number, message: string, public body?: unknown, public retryAfter?: number) {
    super(message);
  }
}

// FastAPI error `detail` can be a string, a list of validation errors
// ({loc, msg, type}), or an arbitrary object. Render each readably; a bare
// String() on an object would print "[object Object]".
function renderErrorDetail(detail: unknown, fallback: string): string {
  if (detail == null) return fallback;
  if (typeof detail === "string") return detail.trim() || fallback;
  if (Array.isArray(detail)) {
    const lines = detail.map((entry) => {
      if (entry && typeof entry === "object" && "msg" in entry) {
        const loc = Array.isArray((entry as { loc?: unknown }).loc) ? ((entry as { loc: unknown[] }).loc).join(".") : "";
        return (loc ? loc + ": " : "") + String((entry as { msg: unknown }).msg);
      }
      return JSON.stringify(entry);
    });
    return lines.join("\n") || fallback;
  }
  if (typeof detail === "object") return JSON.stringify(detail);
  return String(detail);
}

// Shared non-2xx handling: pull detail/error off a parsed JSON body (or use
// the raw text) and build the ApiError. A structured detail
// ({code, message, ...}) renders as its message; callers that need the
// extras read err.body.
function apiErrorFrom(status: number, parsed: unknown, fallback: string, headers?: Headers): ApiError {
  let detail: unknown = undefined;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { detail?: unknown; error?: unknown };
    detail = obj.detail ?? obj.error;
  } else if (typeof parsed === "string") {
    detail = parsed;
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail) && typeof (detail as { message?: unknown }).message === "string") {
    detail = (detail as { message: string }).message;
  }
  const ra = Number.parseInt(headers?.get("retry-after") ?? "", 10);
  return new ApiError(status, renderErrorDetail(detail, fallback), parsed, Number.isFinite(ra) ? ra : undefined);
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text; // HTML error pages (502s from a proxy) are not JSON
  }
}

export interface ClientOptions {
  cfg: CliConfig;
  apiBase: string; // e.g. https://api.hedgespecialty.com/api/v1
  // A static credential (Bindly org API key) sent as a header instead of OAuth.
  apiKey?: string;
  apiKeyHeader?: string; // default "X-Api-Key"
  // Sent on every request (e.g. Hedge-Client: hedge-cli/0.5.0).
  headers?: Record<string, string>;
}

// Auth plus the client's standing headers, shared by every request kind.
async function baseHeaders(opts: ClientOptions, extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}), ...(extra ?? {}) };
  if (opts.apiKey) headers[opts.apiKeyHeader ?? "X-Api-Key"] = opts.apiKey;
  else headers.Authorization = `Bearer ${await bearer(opts.cfg)}`;
  return headers;
}

// Server-returned paths (download_path) carry the /api/v1 prefix; apiBase
// already ends in it. Only same-API relative paths are ever followed.
function apiUrl(opts: ClientOptions, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new ApiError(400, `Not an API path: ${path}`);
  const rel = path.startsWith("/api/v1/") ? path.slice("/api/v1".length) : path;
  return opts.apiBase.replace(/\/$/, "") + rel;
}

// Returns a valid bearer, refreshing (and persisting) if within 60s of expiry.
async function bearer(cfg: CliConfig): Promise<string> {
  const tok = loadToken(cfg);
  if (!tok) throw new ApiError(401, "Not signed in. Run `login` first");
  if (tok.expires_at - 60 > Math.floor(Date.now() / 1000)) return tok.access_token;
  if (tok.grant === "client_credentials" && tok.client_secret) {
    // Machine credentials have no refresh token: renew by re-exchange.
    try {
      const r = await clientCredentialsLogin(tok.token_endpoint, tok.client_id, tok.client_secret, tok.scope);
      const updated: StoredToken = {
        ...tok,
        access_token: r.access_token,
        expires_at: Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600),
        scope: r.scope ?? tok.scope,
      };
      saveToken(cfg, updated);
      return updated.access_token;
    } catch (e) {
      // Keep the stored credential (it may be a transient failure) but say
      // exactly what to do; the message never includes the secret.
      throw new ApiError(401, `${e instanceof Error ? e.message : String(e)}. Check the key under Settings → API keys or run \`login --client-id ... --client-secret ...\` again`);
    }
  }
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
  const url = new URL(apiUrl(opts, path));
  for (const [k, v] of Object.entries(init?.query ?? {})) if (v != null) url.searchParams.set(k, v);
  const headers = await baseHeaders(opts, { Accept: "application/json", ...(init?.headers ?? {}) });
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, { method, headers, body });
  const parsed = parseBody(await res.text());
  if (!res.ok) throw apiErrorFrom(res.status, parsed, `Request failed (${res.status})`, res.headers);
  return parsed as T;
}

// Multipart upload (fetch sets the boundary; JSON path can't). Same auth as
// apiRequest — bearer (refreshing) or the static api key header.
export async function multipartRequest<T = unknown>(
  opts: ClientOptions,
  method: string,
  path: string,
  form: FormData,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers = await baseHeaders(opts, { Accept: "application/json", ...(extraHeaders ?? {}) });
  const res = await fetch(apiUrl(opts, path), { method, headers, body: form });
  const parsed = parseBody(await res.text());
  if (!res.ok) throw apiErrorFrom(res.status, parsed, `Upload failed (${res.status})`, res.headers);
  return parsed as T;
}

// Server-derived filenames are untrusted: keep only the final path segment
// (either separator style) and strip control chars plus the characters
// Windows forbids, so the name can never escape the target directory.
export function sanitizeFilename(name: string): string {
  const last = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = last.replace(/[:*?"<>|\u0000-\u001f]/g, "_").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned;
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
  const headers = await baseHeaders(opts);
  const res = await fetch(apiUrl(opts, path), { method, headers });
  if (!res.ok) throw apiErrorFrom(res.status, parseBody(await res.text()), `Download failed (${res.status})`, res.headers);
  // Sanitized so a server-supplied filename can never escape the cwd.
  const serverName = dispositionFilename(res.headers.get("content-disposition"));
  const safeName = serverName ? sanitizeFilename(serverName) : "";
  const target = outPath ?? (safeName || undefined) ?? fallbackName;
  if (!target) throw new ApiError(500, "No output filename (pass -o <file>)");
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return target;
}
