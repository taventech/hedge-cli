# hedge

The Hedge broker portal from your terminal. Submit risks, check appetite, run instant carrier quotes, and track status, policies, and payments.

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
hedge login                      # device-code sign in (prints a code + URL)
hedge appetite "hvac contractor" --state TX
hedge submit --insured "Acme HVAC" --narrative "Residential HVAC install and repair" --lob commercial_general_liability --state TX
hedge upload <submission-id> ./acord-125.pdf
hedge finalize <submission-id>   # start marketing to carriers
hedge status <submission-id>
```

## Commands

| Command | What it does |
| --- | --- |
| `hedge appetite <class> [--state ST] [--lob slug]` | Which markets have appetite for a class of business. |
| `hedge market-requirements <marketId> --lob <slug> [--state ST] [--programs keys]` | What a market needs to quote a line: the application package plus per-program requirements. Market ids come from `hedge appetite --json`. |
| `hedge submit --insured <name> --narrative <text> [flags]` | Create a submission (does not market it yet). Applicant, contact, address, and exposure flags are listed in `hedge submit --help`; `--body <file\|->` sends a full JSON body, with explicit flags taking precedence. |
| `hedge upload <submissionId> <file.pdf> [--name label]` | Attach an ACORD, loss runs, or supplement. |
| `hedge requirements <submissionId>` | What the submission still needs (per market, forms, carrier questions). |
| `hedge finalize <submissionId>` | Start marketing the submission to carriers. |
| `hedge status <submissionId>` | Submission detail plus the live per-carrier marketing table, status roll-up, and documents on file. |
| `hedge submissions [--status state] [--search q] [--limit n] [--offset n] [--updated-since iso]` | List your brokerage's submissions, with filters and paging. |
| `hedge documents <submissionId>` | List a submission's finalized documents (ACORDs, quotes, binders). |
| `hedge download <documentId> [-o file]` | Download a finalized document PDF. |
| `hedge quotes <submissionId>` | List instant-quote carrier sessions and their open questions. |
| `hedge answer <submissionId> <sessionId> --set k=v [--set k=v ...]` | Answer a carrier session's questions. |
| `hedge request-quote <submissionId> <sessionId>` | Close a carrier session, request an indication, then a quote. |
| `hedge policies` | List bound policies with term dates. |
| `hedge policy <policyId>` | Policy detail: term, premium, commission, payment plan, documents. Policy ids come from `hedge policies --json`. |
| `hedge policy-doc <policyId> <kind> [-o file]` | Download a policy PDF; kind is `binder`, `policy`, or `declarations`. |
| `hedge payments` | List payment and invoice status, with invoice links. |
| `hedge whoami` | Show the signed-in broker and brokerage. |
| `hedge login` / `hedge logout` | Sign in and out. |

Add `--json` to any command for the raw API response, so the CLI composes in scripts:

```bash
hedge submissions --json | jq '.[] | select(.status_label=="Quoted") | .insured_name'
```

Add `--staging` to any command (or set `HEDGE_ENV=staging`) to target the staging environment.

## Example: a submission end to end

```bash
hedge login
hedge appetite "roofing contractor" --state CA
hedge submit \
  --insured "Peak Roofing LLC" \
  --narrative "Residential re-roofing, no hot tar, no work over 3 stories" \
  --lob commercial_general_liability,commercial_property \
  --effective 2026-08-01 \
  --website https://peakroofing.example.com \
  --fein 12-3456789 \
  --entity-type llc \
  --naics 238160 \
  --business-phone "415-555-0100" \
  --business-email office@peakroofing.example.com \
  --contact-first Dana --contact-last Rivera \
  --contact-email dana@peakroofing.example.com \
  --contact-phone "415-555-0101" \
  --address "1200 Harrison St" --address2 "Suite 4" \
  --city Oakland --state CA --zip 94612 \
  --tiv 250000 --payroll 900000 --vehicles 3
hedge upload <submission-id> ./acord-125.pdf --name "ACORD 125"
hedge requirements <submission-id>
hedge finalize <submission-id>
hedge status <submission-id>
hedge documents <submission-id>
hedge download <document-id> -o quote.pdf
```

When any address flag is present, `--state` fills the mailing address state. With `--state` alone it is sent as the submission's top-level `primary_state`.

Prefer building the request in a file (or another program)? Send a full JSON body; explicit flags still win over matching top-level keys:

```bash
hedge submit --body ./submission.json
cat submission.json | hedge submit --body - --effective 2026-09-01
```

## Signing in

The CLI signs in with OAuth 2.1, so there are no API keys to copy around for the interactive flow, and it works over SSH.

| Mode | How | When to use |
| --- | --- | --- |
| Device code (default) | `hedge login` | Anywhere, including headless servers and SSH. Prints a short code and a URL to approve in any browser. |
| Browser (loopback) | `hedge login --browser` | A local machine with a browser. Opens it and captures the redirect on `127.0.0.1`. |

Credentials are stored per profile at `~/.config/taven-cli/hedge.<profile>.json` with `0600` permissions. Access tokens are refreshed automatically. Sign out with `hedge logout`.

The CLI requests the `broker_mcp` and `broker_submit` scopes. Submitting on a brokerage's behalf requires that the brokerage has connected apps and programmatic submission enabled by Hedge. Read commands (appetite, market-requirements, submissions, status, requirements, documents, download, quotes, policies, policy, policy-doc, payments) work with either scope. `submit`, `upload`, `finalize`, `answer`, and `request-quote` require `broker_submit`.

## License

MIT. See [LICENSE](LICENSE).
