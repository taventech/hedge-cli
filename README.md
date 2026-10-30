# hedge

Quote Hedge Instant Quote markets from your terminal or a script. `hedge appetite` says which instant markets will quote a risk, `hedge requirements` lists everything each one needs, `hedge create` opens the file, `hedge answer` fills the gaps, `hedge quote` requests the quotes, `hedge quotes --download` saves every quote PDF and `hedge bind-link` returns the link to bind.

**Instant markets only.** Files created over the API and the CLI reach Hedge Instant Quote markets only. When no instant market fits a risk, the CLI says so and prints where to email it and what to include (`email_us`); Hedge's other markets are reached by email.

## Install

Three ways to install. Pick one.

### npm (requires Node.js 18 or newer)

```bash
npm install -g hedge-broker   # provides `hedge`
```

Or run without installing:

```bash
npx hedge-broker appetite "residential landscaping" --state CA --lines gl
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
hedge login                                    # device-code sign in (prints a code + URL)

# 1. Which instant markets fit
hedge appetite "Residential landscaping and lawn care, 6 employees" --state CA --lines gl --naics 561730

# 2. What they need: the core fields, then each market's own questions
hedge requirements --state CA --lines gl

# 3. Create the file, answering what you already know
hedge create --insured "Green Thumb Landscaping LLC" \
  --narrative "Residential landscaping and lawn care, 6 employees, no tree work over 15 ft" \
  --lines gl --state CA --naics 561730 --effective 2026-11-15 \
  --set annual_revenue=850000 --set employee_count=6 \
  --client-reference AI-9f3c2b

# 4. Follow each market, confirm the classes Hedge suggests, answer what is still missing
hedge status <submission-id> --wait
hedge answer <submission-id> --confirm-suggestions
hedge answer <submission-id> --set <key>=<value>

# 5. Quote, read the quotes, save the PDFs, get the bind link
hedge quote <submission-id> --wait
hedge quotes <submission-id> --download ./quotes
hedge bind-link <submission-id> <quote-id>
```

Each market on a file has one state: `preparing` (Hedge is building its application; poll), `needs_answers` (answer the listed questions), `ready`, `quoting`, `quoted`, `declined` or `not_a_fit`. `hedge status`, `create`, `intake`, `answer` and `quote` all print that state per market, the questions still missing, the values Hedge suggests (a class, for example) for you to confirm, and the next command to run. `hedge answer <id> --confirm-suggestions` confirms every suggestion as it stands (the portal's "Confirm all and continue"); to pick another value, answer that question with `--set` instead.

Pass `--quote` on `create` or `intake` to have every market quote as soon as it is ready.

## Claude skill

[`skills/hedge-broker`](skills/hedge-broker) teaches Claude the same flow over Hedge's MCP connector. It checks instant appetite, asks the client only the questions the markets need (once), creates the file, quotes it, and hands back PDFs and a bind link. Its [README](skills/hedge-broker/README.md) covers setup in Claude Code, claude.ai and headless agents.

## Answers: `--set`

`hedge create` and `hedge answer` take answers with `--set`, repeatable:

| Form | Sends | Use it for |
| --- | --- | --- |
| `--set annual_revenue=850000` | `shared_answers.annual_revenue = 850000` | A canonical key: answered once, it fills every market that asks it. |
| `--set <program_id>:gl_each_occurrence_limit=1000000` | `answers[program_id].gl_each_occurrence_limit` | A question only that market asks (keys `program.<slug>.<id>` in `hedge requirements`). |
| `--set website:='"12345"'` | exact JSON | Anything that must not be typed for you. |

With `=`, plain numbers and `true`/`false` are sent typed; everything else (and a digit string with a leading zero, like a ZIP) is text. With `:=` the value is parsed as JSON. `hedge requirements` prints the exact `--set` target for every question. Answers are all or nothing: if one is refused, none is saved and the CLI lists why.

For full control, send the request body as JSON with `--file payload.json` (or `--file -` for stdin); flags win over the body's fields. The body is the API's: `applicant`, `narrative`, `lines_of_business`, `primary_state`, `effective_date`, `program_ids`, `shared_answers`, `answers`, `client_reference`, `quote`, `producer_email`.

## When no instant market fits

```text
$ hedge appetite --state NV --lines gl
No Hedge Instant Quote market fits this risk; it can't be filed over the API.

Email it to Hedge instead:
  to:       submissions@hedgespecialty.com
  subject:  New submission: ...
  include:
    - ACORD 125 (Commercial Insurance Application)
    - ACORD 126 (General Liability)
    ...
```

`hedge create` and `hedge intake` answer the same way (`422 no_instant_market`) and create nothing.

## Commands

| Command | What it does |
| --- | --- |
| `hedge appetite [description] --state ST --lines l1,l2 [--naics code]` | Which Hedge Instant Quote markets will quote the risk, with the class Hedge would use per carrier. Prints `email_us` when none fits. |
| `hedge requirements --state ST --lines l1,l2 [--programs id,id]` | The core fields of a file and each instant market's own questions, per market, with the `--set` target for each. Without `--programs` it uses every market `hedge appetite` returns. |
| `hedge create [flags] [--set k=v ...] [--programs ids] [--client-reference ref] [--quote] [--file body.json\|-]` | Create a file for the instant markets (alias `submit`). Needs the insured, narrative, lines and state. |
| `hedge intake [files...] [--text t\|--text-file path\|-] [--insured] [--lines] [--state] [--effective] [--programs] [--client-reference] [--quote]` | Create a file from documents and/or text (up to 20 files, 15 MB each, 60 MB total). Hedge reads them and prefills the applications. |
| `hedge status <id> [--wait] [--timeout min]` | Each market's state and what it still needs. `--wait` polls every 5 seconds until no market is preparing or quoting. |
| `hedge answer <id> [--set k=v ...] [--confirm-suggestions] [--file answers.json]` | Answer what the markets need. `--confirm-suggestions` confirms every value Hedge suggests (`confirm_suggestions: true`), alone or with answers. |
| `hedge business <id> [--insured] [--address --city --state --zip] [--contact-name] [--contact-email] [--contact-phone] [--effective] [--naics [--description]]` | Correct the file's core facts when `hedge status` says a core field is missing (the insured's contact, for example). The markets re-prepare. |
| `hedge quote <id> [--programs ids] [--wait]` | Request quotes from the ready markets. A market that still needs answers says what (exit code 1 when none could be requested). |
| `hedge quotes <id> [--download [dir]]` | The itemized quotes: premium, total, whether each can be bound, its documents. `--download` saves every PDF: Hedge's quote PDF and the carrier's, including carrier-hosted PDFs. Other carrier-hosted pages (an online proposal) are listed. |
| `hedge bind-link <id> <quoteId> [--for broker\|insured] [--insured-email e] [--attest]` | The link to bind: the broker's bind checklist in the Hedge portal, or the insured's pay-and-bind page where the market takes the insured's payment. |
| `hedge events [--since cursor] [--limit n] [--one-page]` | What changed across all your brokerage's files, oldest first. Prints the cursor to resume from. |
| `hedge submissions [--status s] [--search q] [--limit n] [--offset n] [--updated-since iso]` | List your brokerage's files. |
| `hedge upload <id> <file.pdf> [--name label]` | Attach an ACORD, loss runs or a supplement to a file. |
| `hedge withdraw <id>` | Withdraw a file. |
| `hedge documents <id>` / `hedge download <documentId> [-o file]` | List a file's finalized documents and download one. |
| `hedge forms [search]` / `hedge form <formKey> [-o file]` | Search the blank application forms (the ACORDs `email_us` asks for) and download one. |
| `hedge policies` / `hedge policy <id>` / `hedge policy-doc <id> <kind>` / `hedge payments` | Your bound policies, their documents, and payments. |
| `hedge login` / `hedge logout` / `hedge whoami` | Sign in and out; `whoami` shows the environment, the brokerage and whether the token can submit. |

Global flags:

- `--json`: print the raw API response, so the CLI composes in scripts. Errors print their JSON body too (with `status`), and the exit code is 1.
- `--sandbox` (or `HEDGE_ENV=sandbox`): use the sandbox at `sandbox-api.hedgespecialty.com`, Hedge's test environment with carrier test systems. Sandbox and production keep separate sign-ins; a sandbox key never works on production.

```bash
hedge status <submission-id> --json | jq '.markets[] | {market, state, missing: [.missing[].key]}'
```

## Errors: stop and back off

- **403**: the call is not allowed (for example, submit access is off for your brokerage). It will not change on retry: stop and have a person check access.
- **429**: rate limited. The CLI prints the `Retry-After` seconds; wait that long before the next call.
- **422 / 409**: the CLI prints what to fix (`no_instant_market` with `email_us`, `missing_core` fields, refused answers, a market that is not ready).

The CLI never retries on its own.

## Signing in

| Mode | How | When to use |
| --- | --- | --- |
| Device code (default) | `hedge login` | Anywhere, including headless servers and SSH. Prints a short code and a URL to approve in any browser. |
| Browser (loopback) | `hedge login --browser` | A local machine with a browser. |
| API key | `hedge login --client-id bac_... --client-secret bas_...` | Scripts and agents. Uses the `client_credentials` grant with a key from **Settings → API keys** in the broker portal. Prefer `HEDGE_CLIENT_SECRET` in the environment over the flag. The secret is never printed. |

Reading (appetite, requirements, your files, quotes, documents, events) is open to every brokerage. Creating, answering, quoting and bind links need submit access, which Hedge turns on per brokerage; request it in the portal under **Settings → API keys**. `hedge login` and `hedge whoami` say when a token is read-only.

An API key carries no broker identity, so writes made with one name the producing broker: pass `--producer-email` on `create`, `intake`, `business`, `answer`, `quote`, `bind-link` and `withdraw`.

Every request sends `Hedge-Client: hedge-cli/<version>`. Credentials are stored per environment at `~/.config/taven-cli/hedge.<environment>.json` with `0600` permissions.

## Upgrading from 0.4

0.5 follows the instant-quote flow. `hedge markets`, `finalize`, `answer-asks`, `thread`, `reply`, `bind`, `bind-status`, `bind-upload`, `bind-submit`, `programs`, `program-schema`, `market-requirements` and `request-quote` were removed; running one prints the command that replaced it. `hedge quotes` now reads the itemized quotes (it used to list carrier sessions), `hedge answer` answers the file (it used to answer one carrier session), `hedge requirements` and `hedge appetite` are the flow's reads, and `submit` is `create` with `--lines` (was `--lob`) and `--file` (was `--body`). `--staging` became `--sandbox`.

## License

MIT. See [LICENSE](LICENSE).
