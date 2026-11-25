# Kobolt

Ogun businesses pay creators to post about them, at home or abroad. Kobolt holds the money until the posts check out, then pays each creator in their own currency.

Kobolt is a ZApp: it runs inside Zend. Brands and creators sign in with Zend, money is held and paid by Zend's prize rules, and the deal lives in the chat between them. **@kobolt**, Kobolt's automated account, checks drafts in a DM and sends deal updates.

Built at OgunInnovate 2026, on Zend's public developer kit (`@zendfi/appkit`, MIT). Zend is our own company; Kobolt uses only its public kit.

## What's here

| Path | What |
|---|---|
| `server/src` | Fastify server: sessions, deals API, money flow, webhooks, scheduler, `/ops` |
| `server/src/checker` | TikTok reader, code rules, AI checks (3 samples, quotes verified), decision |
| `bot/main.ts` | @kobolt: sends queued updates, answers "check before you post" |
| `web/src` | Preact pages: home, brief, deal, live check, payout wait, paid, creator page |
| `db/schema.sql` | Postgres schema, applied on every start |
| `deploy/` | Dockerfile, compose (Caddy, web, bot, Postgres, hourly backups), Caddyfile |
| `zapp.template.json` | Zend manifest; `node deploy/manifest.mjs <origin> <resolver public key> [bot]` writes `zapp.json` |

## How a deal works

1. The brand taps **+ → Apps → Kobolt → Start a deal** in a chat with the creator, fills the brief, and holds the money (Zend prize, `maxPlayers: 3`, 10-minute wait, `reference` = deal id).
2. The creator accepts (joins the prize) and posts on TikTok, then pastes the links.
3. Kobolt reads each post from TikTok and runs the rules (right app, their account, posted after the offer, still up, not reused, exact hashtags, ad label near the start, no competitor). If every rule passes, the AI runs 3 times on the caption (ad label is real, about the product, no competitor hints, no ruled-out claims, including Pidgin and Yoruba). Each answer has to quote the caption, and Kobolt confirms the quote is really there.
4. A post passes only if the rules pass and all 3 AI runs agree. Anything unsure, or any caption that tries to instruct the checker, goes to the brand. If the brand doesn't answer within 24 hours, the creator is paid for the post as long as no check failed.
5. Kobolt sends one result: pay per passed post, the rest goes back. After Zend's 10-minute wait (the brand can stop the payout during it), Zend pays the creator.

The page never decides anything: every state change is confirmed with Zend (webhook or `getPrize`) and every interaction move is `serverOnly`.

## Run locally

```sh
npm ci
docker run --rm -e POSTGRES_USER=kobolt -e POSTGRES_PASSWORD=kobolt -e POSTGRES_DB=kobolt -p 55432:5432 postgres:16-alpine
npm run build
DATABASE_URL=postgres://kobolt:kobolt@localhost:55432/kobolt PORT=3000 npm start
```

## Deploy

The same image (`deploy/Dockerfile`) runs anywhere: config comes only from env vars, it listens on `$PORT`, keeps no local files, waits for the database and applies the schema on boot. Host health check: `/livez` (process + database). `/healthz` also checks that Zend is reachable.

### Render

1. Push the repo to GitHub, then in Render: **New → Blueprint** → pick the repo. `render.yaml` creates `kobolt` (web), `kobolt-bot` (worker) and `kobolt-db` (Postgres 16).
2. Fill the values Render asks for: `ZEND_APP_KEY`, `ZEND_WEBHOOK_SECRET`, `ZEND_RESOLVER_SEED`, `LLM_API_KEY` (both services). Leave `PUBLIC_ORIGIN` empty to use the `onrender.com` URL. Leave the bot keys empty until @kobolt exists; the worker idles until then.
3. Use a paid plan for the web service. Free instances sleep, which stops the scheduler and delays Zend's webhooks.
4. Point Zend at it: `node deploy/manifest.mjs https://kobolt.onrender.com <resolver public key> && zend apps deploy zapp.json`.

### Nobus (or any VM)

On the VM (Ubuntu 24.04, Docker + compose plugin, ports 80/443 open):

```sh
git clone <repo> kobolt && cd kobolt
cp .env.example .env    # fill in the values (never commit .env)
docker compose -f deploy/compose.yml --env-file .env up -d --build
# after @kobolt exists:
docker compose -f deploy/compose.yml --env-file .env --profile bot up -d
```

Redeploy: `git pull && docker compose -f deploy/compose.yml --env-file .env --profile bot up -d --build`.
Logs: `docker compose -f deploy/compose.yml logs -f web bot`. Health: `/healthz`. Operator page: `/ops?token=<OPS_TOKEN>`.

## Zend setup

```sh
zend apps create kobolt "Kobolt"          # ZEND_APP_KEY, ZEND_WEBHOOK_SECRET
zend apps resolver-key                     # ZEND_RESOLVER_SEED (server) + public key (manifest)
node deploy/manifest.mjs https://<origin> <public key>
zend apps check zapp.json && zend apps deploy zapp.json
zend apps testers add kobolt <account>
zend bot create "Kobolt" --handle kobolt --scopes read,dm_send,post_card
node deploy/manifest.mjs https://<origin> <public key> kobolt && zend apps deploy zapp.json
```

## Demo controls

With `DEMO_MODE=1`, a 90-second accept window is allowed. On `/ops`, **Hold result** keeps a deal from paying automatically, and **Send result now** sends it, so a pre-run deal can pay out during the pitch.

## Limits we name

- $20 per deal (Zend's cap while the prize rules are new). Smallest deal $1.
- 10-minute wait after approval, fixed in Zend's prize rules. It is the brand's chance to stop a payout.
- TikTok only is read automatically; Instagram posts are checked by the brand.
- Zend's own sheets say "prize"; Kobolt's note before each sheet explains it.
- Zend doesn't tell apps a person's currency, so Kobolt guesses from the phone and uses a public rate for "about" figures.
