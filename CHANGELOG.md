# Changelog

All notable changes to `hedge-broker` are documented here. This project follows
[Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added

- `answer <id> --confirm-suggestions`: sends `confirm_suggestions: true` on `PATCH /broker/submissions/{id}/answers`, confirming every value Hedge suggests (a class, for example) as it stands; alone or with `--set` answers. `status` and the other flow commands print it as the next step when Hedge has suggestions.
- `npm test`: the `answer` request body checked against a local mock API.

## [0.5.0] - 2026-10-30

The instant-quote flow. Files created over the API reach Hedge Instant Quote
markets only, and the commands follow the flow: appetite, requirements,
create, answer, quote, quotes and PDFs, bind link. Risks no instant market
writes are refused with where to email them (`email_us`).

### Added

- `appetite [description] --state --lines [--naics]`: `POST /broker/appetite/instant`, the instant markets that fit, with the class Hedge would use per carrier; prints `email_us` when none fits.
- `requirements --state --lines [--programs ids]`: `POST /broker/requirements`, the core fields plus each market's own questions, with the `--set` target for each. Without `--programs` it uses every market `appetite` returns.
- `create` (alias `submit`): `POST /broker/submissions` with `--programs`, `--set` answers, `--client-reference`, `--quote` and `--file` for the full JSON body.
- `status <id> [--wait]`: `GET /broker/submissions/{id}/instant-quotes`, each market's state, missing answers and Hedge's suggestions.
- `business <id>`: `PATCH /broker/submissions/{id}/business`, correct the file's core facts (name, mailing address, contact, class, effective date) when `status` says a core field is missing; the markets re-prepare.
- `answer <id> --set k=v [--file]`: `PATCH /broker/submissions/{id}/answers`. `key=value` answers a canonical key for every market; `<program_id>:<id>=value` one market's own question; numbers and true/false are typed; `key:=<json>` sends exact JSON.
- `quote <id> [--programs] [--wait]`: `POST /broker/submissions/{id}/quote`, with the per-market outcome (exit 1 on a 409).
- `quotes <id> [--download [dir]]`: the itemized `GET /broker/submissions/{id}/quotes`; `--download` saves every quote PDF: Hedge's quote PDF, the carrier PDFs Hedge stored and carrier-hosted PDFs (fetched without your token); other carrier-hosted pages are listed.
- `bind-link <id> <quoteId> [--for broker|insured]`: `POST .../quotes/{quote_id}/bind-link`.
- `events [--since]`: the brokerage-wide `GET /broker/events` feed, following `next_cursor` to the tail.
- `--sandbox` (or `HEDGE_ENV=sandbox`): sandbox-api.hedgespecialty.com, with its own stored sign-in.
- Every request sends `Hedge-Client: hedge-cli/0.5.0`.
- Structured errors print what to do: `email_us` for `no_instant_market`, missing fields, refused answers, assumptions to confirm; a 403 says not to retry, a 429 prints `Retry-After`. With `--json`, errors print their JSON body and exit 1.
- `login` and `whoami` say when a token is read-only (submit access is turned on per brokerage by Hedge).

### Changed

- `intake` returns the per-market file state like `create`, and takes `--programs`, `--client-reference` and `--quote`; `--lob` is `--lines`; `--hold` is gone (an instant file never starts marketing).
- `quotes` and `answer` now work on the file (they used to work one carrier session).
- `requirements`, `appetite` and `status` are the flow's reads (see Added).
- `submit` is `create`: `--lob` is `--lines`, `--body` is `--file`; `--hold`, `--tiv`, `--vehicles`, `--payroll` and `--insured-id` are gone (send them in `--file` or answer them with `--set`).

### Removed

- `markets`, `finalize`, `answer-asks`, `thread`, `reply`, `bind`, `bind-status`, `bind-upload`, `bind-submit`, `programs`, `program-schema`, `market-requirements`, `request-quote`. Each still parses and prints the command that replaced it.
- `--staging` is hidden; use `--sandbox`.

## [0.4.0] - 2026-09-19

The Hedge broker API rework: creating a submission now starts the run, markets
come back in three categories, the conversation with Hedge is readable and
answerable over the API, and binds happen over the API with explicit
attestation of the assumptions.

### Added

- `intake [files...] --text|--text-file [--insured] [--lob] [--state] [--effective] [--producer-email] [--hold]`: send Hedge a risk as free text and/or PDFs (multipart `POST /broker/intake`). Sends an `Idempotency-Key` per run (`--idempotency-key` to supply your own).
- `markets <submissionId> [--wait]`: `GET /broker/submissions/{id}/markets` rendered in the three categories (Hedge Instant Quote, Hedge Binding, Hedge Specialty) with each lane's status, `needs_from_you`, assumptions (`[ ]` standing / `[x]` confirmed) and released quotes.
- `thread <submissionId> [--since] [--limit] [--one-page]`: the conversation with Hedge, oldest first, following `next_cursor` to the tail; `--json` returns `{messages, next_cursor, last_cursor}`.
- `reply <submissionId> <text|-> [--attach ids] [--producer-email]`: reply to Hedge on the thread with an `Idempotency-Key`.
- `answer-asks <submissionId> [--set k=v ...]`: batch answers to `outstanding-requirements`; without `--set` lists the items and keys. Values are typed from the item's `input` (number, bool) before sending.
- `withdraw <submissionId>`.
- `bind <submissionId> --quote <quoteId> [--payment in_full|monthly] [--attest | --attest-keys k1,k2]`: create a bind request. A 409 `assumptions_unconfirmed` prints every assumption and the exact re-run to attest (exit 1; `--json` prints the 409 detail).
- `bind-status <submissionId> [bindRequestId]`, `bind-upload <submissionId> <bindRequestId> <contingencyId> <file.pdf> [--notes]`, `bind-submit <submissionId> <bindRequestId> [--attest | --attest-keys]`.
- `programs [--category] [--lob] [--state]` and `program-schema <programId> [--lob] [--state]`: the program catalog with categories and the application question schema for instant-quote programs.
- `login --client-id <id> --client-secret <secret>` (or `HEDGE_CLIENT_SECRET`): machine sign-in with the `client_credentials` grant (scope `broker_mcp broker_submit`). The token is cached with its expiry and renewed by re-exchange; the secret is never printed.
- `submit --hold`: keep the draft instead of starting the run.

### Changed

- `submit` now starts the run on create (Hedge matches appetite, emails the producer the clearance, opens the lanes and quotes the instant-quote markets), matching the API. Its output shows `marketing_status` and `next_step` and points at `hedge markets`.
- `finalize` is now "release a held submission": it starts the run for a submission created with `--hold` and is idempotent on one already running.
- `requirements`, `status` and `finalize --wait` hints point at `hedge markets` and describe held drafts instead of "not yet finalized".
- `ApiError` carries the parsed response body so commands can act on structured errors.

## [0.3.2] - 2026-07-23

### Fixed

- `finalize --wait` polls the requirements view (whose `marketing_status` flips the moment lanes attach) instead of the submission detail, which only lists markets Hedge has already contacted.

## [0.3.1] - 2026-07-23

### Added

- `forms [search]` and `form <formKey> [-o file]`: search the blank application-form catalog and download a blank by its key (the keys `hedge requirements` lists).

## [0.3.0] - 2026-07-23

### Added

- `finalize --wait [--timeout minutes]`: poll until markets attach, then print them.
- `requirements` and `status` explain an empty markets list using the server's `marketing_status` (matching vs. not started vs. no appetite) instead of leaving it ambiguous.

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
