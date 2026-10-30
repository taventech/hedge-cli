// `hedge answer` against a local mock API: the request body it sends.
// Run after `npm run build` (it drives dist/index.js): npm test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const SID = "0694932d-1111-4222-8333-444455556666";

let server;
let base;
let configHome;
const requests = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ submission_id: SID, markets: [], suggested: [], warnings: [] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  // A stored, unexpired credential for the "local" profile (HEDGE_API_URL).
  configHome = mkdtempSync(join(tmpdir(), "hedge-cli-test-"));
  mkdirSync(join(configHome, "taven-cli"), { recursive: true });
  writeFileSync(
    join(configHome, "taven-cli", "hedge.local.json"),
    JSON.stringify({ access_token: "test-token", expires_at: Math.floor(Date.now() / 1000) + 3600, token_endpoint: `${base}/oauth/token`, client_id: "test" }),
  );
});

after(() => {
  server.close();
  rmSync(configHome, { recursive: true, force: true });
});

function hedge(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, HEDGE_API_URL: base, XDG_CONFIG_HOME: configHome } }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr }),
    );
  });
}

function lastAnswersBody() {
  const r = requests.filter((q) => q.method === "PATCH" && q.url === `/api/v1/broker/submissions/${SID}/answers`).at(-1);
  assert.ok(r, "no PATCH .../answers was sent");
  return r.body;
}

test("--confirm-suggestions alone confirms Hedge's suggestions", async () => {
  const r = await hedge("answer", SID, "--confirm-suggestions", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastAnswersBody(), { confirm_suggestions: true });
});

test("--confirm-suggestions goes alongside --set answers", async () => {
  const r = await hedge("answer", SID, "--confirm-suggestions", "--set", "annual_revenue=900000", "--producer-email", "p@example.com", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastAnswersBody(), { shared_answers: { annual_revenue: 900000 }, confirm_suggestions: true, producer_email: "p@example.com" });
});

test("a --file body with only confirm_suggestions is sent as is", async () => {
  const f = join(configHome, "confirm.json");
  writeFileSync(f, JSON.stringify({ confirm_suggestions: true }));
  const r = await hedge("answer", SID, "--file", f, "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastAnswersBody(), { confirm_suggestions: true });
});

test("nothing to send is refused before any request", async () => {
  const before = requests.length;
  const r = await hedge("answer", SID);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--confirm-suggestions/);
  assert.equal(requests.length, before);
});
