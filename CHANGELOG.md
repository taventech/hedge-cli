# Changelog

All notable changes to `hedge-broker` are documented here. This project follows
[Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com).

## [0.2.0] - 2026-07-06

### Added

- `submit` now covers the full create schema: `--website`, `--fein`, `--entity-type`, `--naics`, `--business-phone`, `--business-email`, `--contact-first`, `--contact-last`, `--contact-email`, `--contact-phone`, `--address`, `--address2`, `--city`, `--zip`, `--tiv`, `--vehicles`, `--payroll`, `--insured-id`, `--producer-email`.
- `submit --body <file|->` sends a full JSON request body from a file or stdin; explicit flags take precedence over matching top-level keys, applicant flags merge over the body's applicant, and address flags merge into its mailing_address.
- `submit` sends an `Idempotency-Key` header: a random UUID per invocation by default, or your own via `--idempotency-key <key>`. Replay engages only when the same key is re-sent within 24h (per brokerage), so scripted retries that must not double-create should pass their own key.
- `submit` fails fast with a clear message when a partial mailing address is given; the API requires `--address`, `--city`, `--state`, and `--zip` to resolve together (fields supplied via `--body` count).
- `submissions` filters: `--limit`, `--offset`, `--updated-since` (alongside the existing `--status` and `--search`).
- `policy <policyId>`: policy detail (term, net premium, total billed, commission, payment plan, documents).
- `policy-doc <policyId> <kind> [-o file]`: download the binder, policy, or declarations PDF.
- `documents <submissionId>`: list a submission's finalized documents.
- `download <documentId> [-o file]`: download a finalized document PDF (filename from Content-Disposition when `-o` is omitted).
- `market-requirements <marketId> --lob <slug> [--state ST] [--programs keys]`: what a market needs to quote a line.
- `status` now renders the live per-carrier marketing table (carrier, line, status, quote premium), a status roll-up, the effective date, and the documents on file.
- `policies` table gains effective and expiration columns; `payments` gains an invoice_url column.

### Fixed

- `submit --state` now actually sends the state (top-level `primary_state`, or the mailing address state when a mailing address is present). In 0.1.0 the flag was accepted but dropped.
- Non-JSON API error bodies (HTML 502s from a proxy) no longer crash uploads with a SyntaxError; the raw text is surfaced instead.
- API validation errors (FastAPI `detail` arrays/objects) render as readable `loc: message` lines instead of `[object Object]`.
- Filenames taken from a server's Content-Disposition header are sanitized (path separators, control characters, and Windows-invalid characters stripped) before writing to disk.

## [0.1.0] - 2026-07-06

### Added

- Initial release.
- OAuth 2.1 sign-in: device-code (default, works over SSH), browser loopback (`--browser`), with automatic token refresh and `0600` credential storage.
- `login`, `logout`, `whoami`.
- Submissions: `submit`, `upload`, `requirements`, `finalize`, `status`, `submissions`.
- Instant carrier quotes: `quotes`, `answer`, `request-quote`.
- `appetite`, `policies`, `payments`.
- Global `--json` output and `--staging` environment switch.
- Distributed three ways: npm (`hedge-broker`), Homebrew (`taventech/tap/hedge`), and a self-contained binary via the curl installer.
