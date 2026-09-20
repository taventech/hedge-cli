# hedge

Send Hedge a risk from your terminal, the way you would email it, and track it to bind. `hedge intake` takes free text and PDFs; Hedge extracts the risk, matches appetite, emails the producer the clearance and opens the market lanes. `hedge markets` shows the three market categories with what each lane still needs from you, the assumptions Hedge made and the released quotes. `hedge thread` is the conversation with Hedge; `hedge reply` answers it. `hedge bind` requests a bind with explicit attestation of the assumptions.

## Install

Three ways to install. Pick one.

### npm (requires Node.js 18 or newer)

```bash
npm install -g hedge-broker   # provides `hedge`
```

Or run without installing:

```bash
npx hedge-broker appetite "roofing contractor" --state CA
```

### Homebrew (self-contained binary, no Node required)

```bash
brew install taventech/tap/hedge
```

### curl (self-contained binary, no Node required)

```bash
curl -fsSL https://github.com/taventech/hedge-cli/releases/latest/download/install.sh | sh
```

The installer downloads the binary for your OS and CPU into `$HOME/.local/bin`. Add that directory to your `PATH` if it is not already there.

## Quickstart

```bash
hedge login                                            # device-code sign in (prints a code + URL)
hedge intake ./acord-125.pdf ./loss-runs.pdf \
  --text "Peak Roofing LLC, residential re-roofing in CA, 12 employees, GL and property, eff 10/1"
hedge markets <submission-id> --wait                   # the three categories, asks, assumptions, quotes
hedge thread <submission-id>                           # the clearance email, questions, quote deliveries
hedge reply <submission-id> "Payroll is 900k, no work over 3 stories"
hedge bind <submission-id> --quote <quote-id>          # 409 lists the assumptions to attest
hedge bind <submission-id> --quote <quote-id> --attest # after the agent reviewed each one
```

Creating a submission starts the run. There is no separate "go shop it" step: `hedge intake` and `hedge submit` both start marketing as soon as the create commits, exactly like emailing Hedge the risk. Pass `--hold` to keep the draft (attach documents, answer requirements), then `hedge finalize <id>` releases it.

## The three market categories

`hedge markets` always returns all three, in this order:

| Category | Label | What it is |
| --- | --- | --- |
| `instant_quote` | Hedge Instant Quote | Connected carrier APIs, quoted on recorded favorable assumptions. Each assumption is a pre-bind attestation the producer must confirm. |
| `binding` | Hedge Binding | Markets Hedge quotes for you. |
| `specialty` | Hedge Specialty | Email markets that need the completed ACORDs, program requirements and loss runs. |

Each lane carries its status, `submit_ready`, `needs_from_you` (only while the lane is gapped), `assumptions` (`[ ]` still standing, `[x]` confirmed) and released firm `quotes` with their `quote_id`.

## Commands

| Command | What it does |
| --- | --- |
| `hedge intake [files...] [--text <text>\|--text-file <path\|->] [--insured <name>] [--lob <slugs>] [--state <ST>] [--effective <date>] [--producer-email <email>] [--hold]` | Send Hedge a risk as text and/or PDFs (up to 20, 15 MB each). Creates the submission and starts the run. Requires `--text`/`--text-file` or `--insured`. |
| `hedge submit --insured <name> --narrative <text> [flags] [--hold]` | Create a submission from structured fields and start the run. `--body <file\|->` sends a full JSON body, with explicit flags taking precedence; see `hedge submit --help`. |
| `hedge markets <submissionId> [--wait] [--timeout min]` | The markets being tried in the three categories, with status, `needs_from_you`, assumptions and quotes. `--wait` polls until a lane attaches (usually ~5 minutes after create). |
| `hedge thread <submissionId> [--since cursor] [--limit n] [--one-page]` | The conversation with Hedge, oldest first. Follows `next_cursor` to the tail; `--json` returns `{messages, next_cursor, last_cursor}`. |
| `hedge reply <submissionId> <text\|-> [--attach ids] [--producer-email]` | Reply to Hedge exactly as you would reply to its email: answer a question, send a revision, authorize a bind. Hedge answers on the thread within a couple of minutes. |
| `hedge answer-asks <submissionId> [--set k=v ...] [--producer-email]` | Answer the outstanding items the matched markets still need, in one batch. Without `--set` it lists the items and their keys; values are typed per the item's input. |
| `hedge withdraw <submissionId> [--producer-email]` | Withdraw: a held draft is deleted, a live placement is pulled from every engaged market. |
| `hedge bind <submissionId> --quote <quoteId> [--payment in_full\|monthly] [--attest \| --attest-keys k1,k2] [--producer-email]` | Request to bind a released quote. While assumptions stand unconfirmed the API answers 409 `assumptions_unconfirmed`; the CLI prints them and the exact re-run with `--attest`. |
| `hedge bind-status <submissionId> [bindRequestId]` | Bind requests on a submission, or one in full: status, unconfirmed assumptions, contingencies with upload paths, next steps. |
| `hedge bind-upload <submissionId> <bindRequestId> <contingencyId> <file.pdf> [--notes]` | Attach a PDF to a pre-bind contingency while the request is drafted. |
| `hedge bind-submit <submissionId> <bindRequestId> [--attest \| --attest-keys]` | Submit the drafted bind request to Hedge for placement. Same 409 handling as `bind`. |
| `hedge programs [--category c] [--lob slug] [--state ST]` | The carrier programs your brokerage can quote, one row per program with its category. |
| `hedge program-schema <programId> [--lob slug] [--state ST]` | The application question schema for an instant-quote program, for your own application builder. |
| `hedge upload <submissionId> <file.pdf> [--name label]` | Attach an ACORD, loss runs, or supplement. Documents uploaded after create flow into the open lanes. |
| `hedge requirements <submissionId>` | The gaps view: what the submission still needs (per market, forms, carrier questions). |
| `hedge finalize <submissionId> [--wait]` | Release a held submission (one created with `--hold`). Idempotent on a submission whose run already started. |
| `hedge status <submissionId>` | Submission detail plus the live per-carrier marketing table, status roll-up, and documents on file. |
| `hedge submissions [--status state] [--search q] [--limit n] [--offset n] [--updated-since iso]` | List your brokerage's submissions, with filters and paging. |
| `hedge appetite <class> [--state ST] [--lob slug]` | Which markets have appetite for a class of business. |
| `hedge market-requirements <marketId> --lob <slug> [--state ST] [--programs keys]` | What a market needs to quote a line. Market ids come from `hedge appetite --json`. |
| `hedge forms [search]` / `hedge form <formKey> [-o file]` | Search the blank application-form catalog and download a blank. |
| `hedge documents <submissionId>` / `hedge download <documentId> [-o file]` | List a submission's finalized documents and download one. |
| `hedge quotes <submissionId>` / `hedge answer <submissionId> <sessionId> --set k=v` / `hedge request-quote <submissionId> <sessionId>` | Work an instant-quote carrier session directly. |
| `hedge policies` / `hedge policy <policyId>` / `hedge policy-doc <policyId> <kind> [-o file]` | Bound policies, one policy's detail, and its `binder`, `policy` or `declarations` PDF. |
| `hedge payments` | Payment and invoice status, with invoice links. |
| `hedge whoami` | Show the signed-in broker and brokerage. |
| `hedge login [--browser] [--client-id <id> --client-secret <secret>]` / `hedge logout` | Sign in (device code, browser, or a machine credential) and out. |

Add `--json` to any command for the raw API response, so the CLI composes in scripts:

```bash
hedge markets <submission-id> --json | jq '.categories[] | select(.category=="instant_quote") | .lanes[] | {market_name, status, quotes}'
```

Add `--staging` to any command (or set `HEDGE_ENV=staging`) to target the staging environment.

## Example: a submission end to end

```bash
hedge login
hedge intake ./acord-125.pdf --text "Peak Roofing LLC, residential re-roofing, no hot tar, no work over 3 stories. 12 employees, payroll 900k, 3 vehicles. GL + property, effective 2026-10-01, Oakland CA." --producer-email dana@youragency.com
hedge markets <submission-id> --wait
#   Hedge Instant Quote: lanes quoted on assumptions ([ ] = still to confirm)
#   Hedge Binding:       markets Hedge quotes for you, with needs_from_you
#   Hedge Specialty:     email markets waiting on completed ACORDs / loss runs
hedge answer-asks <submission-id>                              # list the outstanding asks and their keys
hedge answer-asks <submission-id> --set years_in_business=8 --set prior_losses=false
hedge upload <submission-id> ./supplemental.pdf --name "Roofing supplement"
hedge thread <submission-id>                                   # the clearance email and Hedge's questions
hedge reply <submission-id> "No hot-tar work; the 3-story limit is firm."
hedge bind <submission-id> --quote <quote-id> --payment in_full
#   409: assumptions unconfirmed -> lists each one and the re-run
hedge bind <submission-id> --quote <quote-id> --payment in_full --attest
hedge bind-upload <submission-id> <bind-request-id> <contingency-id> ./signed-app.pdf
hedge bind-submit <submission-id> <bind-request-id>
hedge bind-status <submission-id> <bind-request-id>
hedge policies
```

Structured creates still work. `hedge submit` takes the full applicant, contact, address and exposure flags (see `hedge submit --help`), or a JSON body:

```bash
hedge submit --body ./submission.json
cat submission.json | hedge submit --body - --effective 2026-09-01 --hold
hedge finalize <submission-id> --wait     # release the held draft
```

Every `intake`, `submit` and `reply` sends an `Idempotency-Key` header (a random UUID each run). A scripted retry that must not double-create should pass its own key with `--idempotency-key <key>`.

## Binding and attestation

Instant quotes are obtained on recorded assumptions: values Hedge defaulted on the carrier application because the file did not state them. They print on the signable application, so the retail agent must confirm them before the order reaches the carrier. `hedge markets` lists them per lane; `hedge bind` (and `hedge bind-submit`) answer 409 `assumptions_unconfirmed` while any stand, keep the draft, and the CLI prints every statement plus the exact command to confirm:

- `--attest` confirms every standing assumption on the quote's carrier application.
- `--attest-keys k1,k2` confirms only those keys.

Send either only after the agent has reviewed each statement; the confirmation is recorded on the bind request under the producing broker. Nothing is sent to a carrier until `hedge bind-submit`.

## Signing in

The CLI signs in with OAuth 2.1 and works over SSH. Three modes:

| Mode | How | When to use |
| --- | --- | --- |
| Device code (default) | `hedge login` | Anywhere, including headless servers and SSH. Prints a short code and a URL to approve in any browser. |
| Browser (loopback) | `hedge login --browser` | A local machine with a browser. Opens it and captures the redirect on `127.0.0.1`. |
| Machine credential | `hedge login --client-id bac_... --client-secret bas_...` | Scripts and automation. Uses the `client_credentials` grant with an API key created under **Settings → API keys** in the broker portal. Prefer `HEDGE_CLIENT_SECRET` in the environment over the flag. The token is cached with its expiry and renewed by re-exchange; the secret is never printed. |

Machine credentials carry no broker identity, so writes made with one must name the producing broker: pass `--producer-email` on `intake`, `submit`, `reply`, `answer-asks`, `withdraw`, `bind`, `bind-upload` and `bind-submit`.

Credentials are stored per profile at `~/.config/taven-cli/hedge.<profile>.json` with `0600` permissions. Access tokens are refreshed automatically. Sign out with `hedge logout`.

The CLI requests the `broker_mcp` and `broker_submit` scopes. Read commands work with either scope; `intake`, `submit`, `upload`, `finalize`, `reply`, `answer-asks`, `withdraw`, `bind*`, `answer` and `request-quote` require `broker_submit`.

## License

MIT. See [LICENSE](LICENSE).
