# CLAUDE.md — SportClan v2 Backend

Context for Claude Code. Read this first, every session.

## What this is
Node/Express + TypeScript backend for SportClan v2 — a multi-sport community app for India. Supabase (Postgres) for data, Cloudflare R2 for media, Render for hosting. The React Native/Expo frontend is a separate repo.

## CRITICAL — repo & deploy facts (these were wrong in the old notes; trust these)
- **THIS folder is the real git repo.** It is `~/sportclan-backend.bak` on Dipak's Mac (the name is a historical accident — it IS the live repo). A sibling `~/sportclan-backend` is just an extracted tarball with NO git — never push from there.
- **Hosting is RENDER, not Railway.** Deploy = `git push origin main` → Render auto-deploys from GitHub `sportclanapp-bot/sportclan-backend`. GitHub auth is via `gh` CLI logged in as `sportclanapp-bot`.
- **Render free tier cold-starts** (~50s delay after inactivity). Account for this when testing right after deploy.
- **Live URL:** https://sportclan-backend.onrender.com
- **Supabase project:** `hunxdndtcymiuvkmygnt`. Migrations in `supabase/migrations/`. **Migrations are NOT auto-applied** — run their SQL manually in the Supabase dashboard SQL Editor after deploying.
- **TypeScript strict.** `npx tsc --noEmit` must be clean before every commit.

## Build / test
```bash
npx tsc --noEmit            # must pass before commit
npm run dev                 # local dev (nodemon + ts-node)
npm run build && npm start  # prod-style run (tsc → node dist/index.js)
```

## How to ship a change
1. Edit code in THIS repo.
2. `npx tsc --noEmit` — clean.
3. Schema change? Add `supabase/migrations/NNN_name.sql`, then run its SQL manually in Supabase SQL Editor.
4. `git add -A && git commit -m "..." && git push origin main`.
5. Confirm Render deploy goes live (dashboard), then test (mind the cold start).

## Layout
- `src/routes/*.routes.ts` — ~30 route files (auth, users, teams, matches, scoring, tournaments, community, messages, services, venues, subscriptions, gifts, transactions, notifications, admin, uploads, webhooks, …)
- `src/controllers/*.controller.ts` — handlers
- `src/index.ts` — app wiring + route mounting
- `src/middleware/` — auth, admin gates
- `src/utils/` — supabase client, sportId resolver, response helpers

## Scope locks (do NOT violate)
- **11 sports:** Cricket, Badminton, Football, Tennis, Table Tennis, Pickleball, Chess, Carrom, Volleyball, Basketball, Hockey. Kabaddi & Athletics are NOT in v2 (older seed/migration 001 wrongly includes them — ignore).
- **10 account types** (lowercase slugs): player (default), umpire, coach, commentator, organiser, business, association, club, leagues, other.
- **Economy:** in-app payments ONLY = premium subscription + coin packs. No bookings, no marketplace, no coach payments, no refunds beyond subscription.
- **Pricing:** subs ₹70/120/150/250/300 for 1/2/3/6/12 months. Coin pack ₹50 = 50 coins. Free tier = 5 posts/month (community + profile combined). EARLYBIRDS coupon = 3 months + 50 coins, once per user, expires 12 Sept 2026.
- **When Dipak says "add everything," add everything — never defer.**

## Field-name conventions (frontend sends different keys than DB columns)
Several endpoints accept BOTH the app's key and the DB column:
- post content: `text` (app) ↔ `content` (DB)
- post image: `media_urls[]` (app) ↔ `image_url` (DB)
- message body: `text` ↔ `content`; DM target: `user_id` ↔ `other_user_id`
- Tournament organiser is the **`created_by`** column. The API maps it to `organizer_id` on read — anywhere that reads `row.organizer_id` directly is a BUG.

## Known gotchas (real history — check these first when debugging)
- **`community_posts.post_type`** had a CHECK constraint allowing only `('Player','Match','Tournament','Umpire-Referee','Other')`, which 400'd every post (app sends lowercase types like `general`, `looking_for_team`). Migration `028_post_type_relax.sql` drops it. If posts 400 again, look for a resurrected CHECK on that column.
- **Sport slugs:** sport-profile / rating-history / rival endpoints must resolve slug → UUID via `resolveSportId` (app passes `cricket`, not a UUID).
- **createPost** currently has a TEMP debug `console.log` (`[createPost DEBUG]`) — remove once the post-400 issue is closed.

## 9 confirmed product rules (always honor)
1. No device-fingerprint tracking.
2. No OTP lockout — free retry within the 5-min window.
3. No password-reuse prevention.
4. Profile photos: no size limit (server compresses), no forced circular crop.
5. Commentator account type requires Premium for visibility.
6. Tournament CREATION requires Premium; match + team creation are FREE.
7. Gift catalogue = 10 gifts with locked coin costs: Gold trophy 15, Silver trophy 10, Gold medal 12, Silver medal 8, Best Player 10, Flowers 5, Star player 12, Appreciation 5, Fire 5, Crown 8.
8. (frontend) Home avatar = 40px rounded square (radius 11), not circular.
9. (frontend) Sports grid = 4 columns.

## Pre-launch checklist (before the production Store build)
1. Remove the dev test-data endpoint: delete `src/routes/dev.routes.ts` + `src/controllers/dev.controller.ts`, remove their import/mount in `src/index.ts`.
2. Verify Render env vars: `RAZORPAY_WEBHOOK_SECRET` (backend warns/500s without it), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN` (OTP), `R2_*` (uploads), FCM/Firebase creds (push), `ADMIN_USER_IDS`, `GOOGLE_CLIENT_ID`.
3. Apply all pending migrations in Supabase SQL Editor.
4. Sanity-check: `SELECT * FROM coupon_codes WHERE code='EARLYBIRDS';` → one row, expires 2026-09-12.

## Environment
All secrets in `.env` (loaded via `import 'dotenv/config'`). Never hardcode keys. Frontend env vars use the `EXPO_PUBLIC_` prefix.

## See also
`WORKING_NOTES.md` in the frontend repo (`~/sportclan-v2`) — canonical phase-by-phase history (P0–P12 + polish/hardening passes) and full scope detail.
