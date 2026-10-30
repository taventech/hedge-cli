# hedge-broker: quote with Hedge from Claude

`hedge-broker` is a Claude skill. With it, Claude quotes your commercial risks with Hedge Instant Quote markets:

1. it checks whether Hedge can quote the risk instantly;
2. it asks your client only the questions those markets need, once;
3. it creates the submission and gets the quotes and their PDFs;
4. it gives you a bind link.

It works through the Hedge MCP connector, so you need both: the connector (the tools) and the skill (how to use them).

- Skill: [`SKILL.md`](SKILL.md) (https://raw.githubusercontent.com/taventech/hedge-cli/main/skills/hedge-broker/SKILL.md)
- Skill package for claude.ai: [`hedge-broker.zip`](../hedge-broker.zip) (https://github.com/taventech/hedge-cli/raw/main/skills/hedge-broker.zip)
- Connector URL: `https://mcp.hedgespecialty.com/mcp` (also in the Hedge broker portal under Settings → Integrations)

## Before you start

- You need a Hedge broker portal account.
- Reading (appetite, questions, your files and quotes) works for every brokerage.
- Creating files and requesting quotes needs submit access:
  - Hedge turns submit access on for your brokerage; a brokerage admin can request it in the portal under Settings → API keys;
  - **Agent write access** must be on under Settings → Connected apps.
- Build and test against Hedge's sandbox first: it uses the connector URL `https://sandbox-mcp.hedgespecialty.com/mcp` and your sandbox account. It reaches carrier test systems only, and it only ever emails your own sandbox users.

## Claude Code

1. Add the connector for all your projects, then sign in:

   ```bash
   claude mcp add --transport http --scope user hedge https://mcp.hedgespecialty.com/mcp
   ```

   In Claude Code, run `/mcp`, choose `hedge`, and sign in with your Hedge account in the browser. Approve submit access on the consent screen if you want Claude to create files and request quotes.

2. Install the skill:

   ```bash
   mkdir -p ~/.claude/skills/hedge-broker
   curl -fsSL https://raw.githubusercontent.com/taventech/hedge-cli/main/skills/hedge-broker/SKILL.md -o ~/.claude/skills/hedge-broker/SKILL.md
   ```

3. Ask: "Get GL quotes from Hedge for a tree-care company in Sacramento."

## claude.ai

1. **Add the connector.**
   - Pro and Max: go to Customize → Connectors → Add custom connector. Paste `https://mcp.hedgespecialty.com/mcp`, click Add, then Connect and sign in with your Hedge account.
   - Team and Enterprise: an owner first adds it under Organization settings → Connectors → Add → Custom → Web. Then each member connects it under Customize → Connectors.
2. **Upload the skill.**
   - Download https://github.com/taventech/hedge-cli/raw/main/skills/hedge-broker.zip.
   - Go to Customize → Skills → + → Create skill → Upload a skill, choose the zip, and turn the skill on.
   - Skills need code execution:
     - Pro and Max: Settings → Capabilities;
     - Team and Enterprise: an owner enables it in Organization settings.
3. In a chat with the Hedge connector on, ask for a quote.

## Headless agents with an API key

A brokerage API key (client credentials) works for unattended agents.

1. Exchange the key for a token:

   ```bash
   curl -s https://api.hedgespecialty.com/api/v1/oauth/token \
     -d grant_type=client_credentials -d client_id=$HEDGE_CLIENT_ID -d client_secret=$HEDGE_CLIENT_SECRET
   ```

2. Send the token as `Authorization: Bearer <access_token>`, for example:

   ```bash
   claude mcp add --transport http hedge https://mcp.hedgespecialty.com/mcp --header "Authorization: Bearer $TOKEN"
   ```

3. Mint a new token before `expires_in` runs out. In the sandbox, use `https://sandbox-api.hedgespecialty.com/api/v1/oauth/token` and `https://sandbox-mcp.hedgespecialty.com/mcp`.

An API key acts for the brokerage, not a person, so every write tool needs `producer_email`: the active Hedge portal user the file belongs to.

## Rules your agent follows

- Only Hedge Instant Quote markets are reached here. Anything else goes to Hedge by email, with exactly what the `email_us` block lists.
- It asks only what the markets need, never guesses an answer, and asks you to confirm any value Hedge suggests.
- It gets your OK before it creates, quotes or asks for a bind link.
- It stops on a 403 or 429 instead of retrying.
- Binding is by link: a one-time sign-in link to the Hedge portal's bind checklist, or the insured's own pay-and-bind link where the carrier supports it.
