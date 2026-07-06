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
| `hedge submit --insured <name> --narrative <text> [--lob a,b] [--state ST] [--effective YYYY-MM-DD]` | Create a submission (does not market it yet). |
| `hedge upload <submissionId> <file.pdf> [--name label]` | Attach an ACORD, loss runs, or supplement. |
| `hedge requirements <submissionId>` | What the submission still needs (per market, forms, carrier questions). |
| `hedge finalize <submissionId>` | Start marketing the submission to carriers. |
| `hedge status <submissionId>` | Submission detail plus live marketing and quote status. |
| `hedge submissions [--status state] [--search q]` | List your brokerage's submissions. |
| `hedge quotes <submissionId>` | List instant-quote carrier sessions and their open questions. |
| `hedge answer <submissionId> <sessionId> --set k=v [--set k=v ...]` | Answer a carrier session's questions. |
| `hedge request-quote <submissionId> <sessionId>` | Close a carrier session, request an indication, then a quote. |
| `hedge policies` | List bound policies. |
| `hedge payments` | List payment and invoice status. |
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
  --lob commercial_general_liability \
  --state CA \
  --effective 2026-08-01
hedge upload <submission-id> ./acord-125.pdf --name "ACORD 125"
hedge requirements <submission-id>
hedge finalize <submission-id>
hedge status <submission-id>
```

## Signing in

The CLI signs in with OAuth 2.1, so there are no API keys to copy around for the interactive flow, and it works over SSH.

| Mode | How | When to use |
| --- | --- | --- |
| Device code (default) | `hedge login` | Anywhere, including headless servers and SSH. Prints a short code and a URL to approve in any browser. |
| Browser (loopback) | `hedge login --browser` | A local machine with a browser. Opens it and captures the redirect on `127.0.0.1`. |

Credentials are stored per profile at `~/.config/taven-cli/hedge.<profile>.json` with `0600` permissions. Access tokens are refreshed automatically. Sign out with `hedge logout`.

The CLI requests the `broker_mcp` and `broker_submit` scopes. Submitting on a brokerage's behalf requires that the brokerage has connected apps and programmatic submission enabled by Hedge. Read commands (appetite, submissions, status, requirements, policies, payments) work with either scope. `submit`, `upload`, `finalize`, and the carrier-quote commands require `broker_submit`.

## License

MIT. See [LICENSE](LICENSE).
