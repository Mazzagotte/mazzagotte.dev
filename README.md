# mazzagotte.dev

James's private project hub: every project with its notes, to-dos and links; uptime checks and alerts for every site; and one money ledger. Runs on Cloudflare Workers + D1, built the same way as SpareTime (plain JavaScript, no build step).

- **Dashboard** — the project you touched most recently, latest activity, site status, this month's money, to-dos across all projects, quick links
- **Projects** — notes tagged Note / To do / Idea / Rule / Infra, pin, delete with Undo, links, incidents
- **Monitoring** — checks every site every minute, opens an incident after 2 failures in a row, push alert to your phone, "back up" alert when it recovers, 90-day uptime strip
- **Finances** — income, costs and net by month or year; Stripe payments arrive automatically from the Backend; manual entries for hosting and domains; domain renewals; CSV export
- **⌘K** to jump anywhere, **N** for a quick note, light/dark, works as a home-screen app on your phone

## Set it up (in this order)

### 1. Move the split-flap display off the bare domain

The display (MAZZARI) currently answers at `mazzagotte.dev`. Its move to `splitflap.mazzagotte.dev` is on the
`move-to-splitflap-subdomain` branch of the `mazzari` repo.

1. Browser settings are saved per address, so on the display's browser open **Backup & Restore** and save a backup first.
2. Merge the branch. Cloudflare redeploys it at `splitflap.mazzagotte.dev`.
3. Cloudflare dashboard → **Workers & Pages → mazzari → Settings → Domains & Routes**: if `mazzagotte.dev` is still listed, remove it.
4. Open `https://splitflap.mazzagotte.dev`, restore the backup, and point the display there.

### 2. Turn on the login (Cloudflare Access)

The hub refuses every request until this is done.

1. Cloudflare dashboard → **Zero Trust** (pick the Free plan if asked; it covers up to 50 users). Note your team domain, e.g. `https://yourteam.cloudflareaccess.com`.
2. **Access → Applications → Add an application → Self-hosted**
   - Name `mazzagotte.dev`, domain `mazzagotte.dev`, session 1 month
   - Policy: **Allow**, Include → **Emails** → your email address only
   - Login method: One-time PIN (codes to your email) is fine; add Google or GitHub if you like
   - After saving, copy the **Application Audience (AUD) Tag** from the application's overview
3. Add a **second** self-hosted application for the webhooks, so Railway and Stripe can reach them:
   - Domain `mazzagotte.dev`, path `hooks`
   - Policy: **Bypass**, Include → **Everyone** (each webhook checks its own secret)

### 3. Deploy

Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → `Mazzagotte/mazzagotte.dev`.
Keep the Worker name `mazzagotte-hub` and set:

- **Build command:** `npm run migrate` — creates and updates the database tables
- **Deploy command:** `npx wrangler deploy`

The database (`mazzagotte-hub`) already exists and its id is in `wrangler.jsonc`. The first build creates its tables and loads your projects.

Then **mazzagotte-hub → Settings → Variables and Secrets**:

| Name | Type | Value |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Text | your team domain, e.g. `https://yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | the AUD tag from step 2 |
| `OWNER_EMAIL` | Text | your email (an extra lock: only this address gets in) |
| `RAILWAY_HOOK_SECRET` | Secret | a long random string |
| `DEPLOY_HOOK_SECRET` | Secret | a different long random string |
| `MONEY_HOOK_SECRET` | Secret | a different long random string |

Make random strings with `openssl rand -hex 32`. `keep_vars` in `wrangler.jsonc` keeps these when GitHub deploys run.

### 4. Connect the alerts

- **Railway** → project **BracketWorks** → Settings → **Webhooks** → URL `https://mazzagotte.dev/hooks/railway`,
  custom header `x-webhook-secret: <RAILWAY_HOOK_SECRET>`. Choose deployment events (failed, crashed, deployed).
- **Your phone:** open `https://mazzagotte.dev`, sign in, add it to your home screen (iPhone: Share → Add to Home Screen),
  open it from there, then **Monitoring → Turn on alerts on this device → Send a test alert**.

## Webhooks

All three take JSON over POST and need their secret in `x-webhook-secret` (or `Authorization: Bearer …`).

**`/hooks/railway`** — paste into Railway's project webhooks. Failed deploys alert you; crashes are logged, and 3 in 10 minutes alert you as a crash loop.

**`/hooks/deploy`** — for Cloudflare-built sites (SpareTime, Ada County USBC, MAZZARI). Add a last step to their deploy command:

```bash
curl -fsS -X POST https://mazzagotte.dev/hooks/deploy \
  -H "x-webhook-secret: $DEPLOY_HOOK_SECRET" -H 'content-type: application/json' \
  -d '{"project":"usbc","ok":true,"commit":"'"$WORKERS_CI_COMMIT_SHA"'"}'
```

Project ids: `tc`, `bw`, `st`, `usbc`, `pg`, `mz`, `208`, `gg`.

**`/hooks/money`** — the Tournament Central Backend calls this after it verifies a Stripe webhook:

```json
{ "type": "payment", "amount_cents": 500, "description": "Tournament fee: Spring Classic",
  "external_id": "pi_…", "project": "tc", "occurred_on": "2026-11-12" }
```

`type` is `payment`, `refund`, `fee` (Stripe's cut), `dispute` (alerts you) or `payout` (logged). The same `external_id` is only saved once, so Stripe retries are safe.

## Checks

Starting checks: Tournament Central, BracketWorks, SpareTime, Ada County USBC homepages, and the display's `/api/health`.
The Gutter Gussie homepage check is added switched off — turn it on under **Monitoring → Checks** once the site is deployed.
The Backend's `/health` check is there but switched off until the Backend has that route — turn it on under **Monitoring → Checks**.
Add more checks there (for example `https://review-adacountyusbc.org/health` once it exists).

## How it works

| Piece | Where |
| --- | --- |
| Request handling, login gate, every-minute job | `src/index.js` |
| Cloudflare Access token check | `src/access.js` |
| API for the app | `src/api.js` |
| Uptime checks, incidents | `src/checks.js` |
| Webhooks (Railway, deploys, money) | `src/hooks.js` |
| Activity timeline + push alerts | `src/events.js`, `src/push.js` (same push code as SpareTime) |
| Database | `migrations/` — `0001_init.sql` tables, `0002_seed.sql` your starting projects |
| The app (no build step) | `public/` — `app.js`, `styles.css`, `sw.js` |

Search engines are kept out (`noindex` header and meta tag), and nothing is reachable without signing in.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_NO_AUTH=1 skips the login locally only
npm run db:local
npm run dev                      # http://localhost:8787 — run checks with /__scheduled?cron=*+*+*+*+*
```

Pushes to `main` build and deploy automatically through Cloudflare Workers Builds. If one does not appear in the build history, check that the Cloudflare Workers and Pages GitHub app has access to this repo.

## Backups

Every night at 2:30 AM Mountain the hub copies the hub, SpareTime and Ada County USBC databases to the private R2 bucket `mazzagotte-backups` (gzipped JSON, one file per database per day, kept 30 days). See and download them on Monitoring → Backups, or press **Back up now**. A failed backup sends a push alert.

To restore: download the file, then `node scripts/restore.mjs hub-2026-11-12.json.gz > restore.sql` and `npx wrangler d1 execute <database> --remote --file restore.sql`. Check the SQL first; it replaces the rows in every table it contains.

## GitHub feed

Project pages show recent commits and build status for the project's GitHub link. Public repos work without setup; for private repos (and to avoid GitHub's limits) add a read-only fine-grained token as the secret `GITHUB_TOKEN` on the Worker (Contents: read, Metadata: read, Commit statuses: read).
