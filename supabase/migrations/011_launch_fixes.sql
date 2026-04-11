-- Final-audit fixes: coupon_codes table + DOB privacy toggle.

CREATE TABLE IF NOT EXISTS coupon_codes (
  code                 TEXT PRIMARY KEY,
  benefit_type         TEXT NOT NULL,           -- 'subscription_and_coins', 'coins_only', 'subscription_only'
  subscription_months  INTEGER NOT NULL DEFAULT 0,
  coin_bonus           INTEGER NOT NULL DEFAULT 0,
  max_uses             INTEGER NOT NULL DEFAULT 0,
  used_count           INTEGER NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PRD launch coupon: 3 months premium + 50 coins, 10000 max uses, expires 2026-09-12.
INSERT INTO coupon_codes (code, benefit_type, subscription_months, coin_bonus, max_uses, expires_at)
VALUES ('EARLYBIRDS', 'subscription_and_coins', 3, 50, 10000, '2026-09-12 23:59:59+05:30')
ON CONFLICT (code) DO NOTHING;

-- DOB privacy toggle (PRD 17.5). Defaults to TRUE so existing users keep showing DOB.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_dob BOOLEAN NOT NULL DEFAULT true;

-- Track when we last nudged a user about expiring premium, so we throttle to once/day.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_premium_reminder_at TIMESTAMPTZ;
