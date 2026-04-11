-- Final-audit launch-prep migration.
--
-- coupon_codes / EARLYBIRDS: verified already present in production with
-- the correct values (2026-04-11 introspection):
--   code='EARLYBIRDS', premium_months=3, coins=50, active=true,
--   expires_at='2026-09-12 23:59:59+00', max_uses=NULL (unlimited).
-- The production schema uses `premium_months` / `coins` / `uses_count`
-- (NOT `subscription_months` / `coin_bonus` / `used_count`). No changes
-- to coupon_codes are needed — the row is already correct — but this
-- note keeps future readers from re-seeding it with the wrong columns.

-- PRD 17.5: DOB privacy toggle. Defaults TRUE so existing users keep
-- showing their DOB; the EditProfile Switch flips it off per user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_dob BOOLEAN NOT NULL DEFAULT true;

-- Throttle for the "Premium expires in N days" nudge. We update this
-- timestamp after sending the reminder and skip if the last one was <24h
-- ago, so repeated GET /users/me calls don't spam the same user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_premium_reminder_at TIMESTAMPTZ;
