-- ══════════════════════════════════════════════════════════════════════
-- Migration 006 — Subscriptions, Transactions, Gifts, Feedback, Sessions
-- Part 6: Payments & Settings
-- ══════════════════════════════════════════════════════════════════════

-- 1. SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                   TEXT NOT NULL,                         -- 1_month, 2_months, 3_months, 6_months, 1_year, coins_50
  status                    TEXT NOT NULL DEFAULT 'active',         -- active, pending, expired, cancelled
  amount_inr                INTEGER NOT NULL,                      -- rupees
  currency                  TEXT NOT NULL DEFAULT 'INR',
  payment_provider          TEXT NOT NULL DEFAULT 'razorpay',      -- razorpay | apple | coupon
  provider_subscription_id  TEXT,                                  -- Razorpay subscription_id or Apple originalTransactionId
  provider_order_id         TEXT,                                  -- Razorpay order_id
  provider_payment_id       TEXT,                                  -- Razorpay payment_id or Apple transactionId
  coupon_code               TEXT,                                  -- e.g. EARLYBIRDS
  starts_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                TIMESTAMPTZ,
  auto_renew                BOOLEAN NOT NULL DEFAULT true,
  cancelled_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 2. TRANSACTIONS (payments + coin purchases + coupon redemptions + gift ledger)
CREATE TABLE IF NOT EXISTS transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                          -- subscription, coins, coupon, gift_sent, gift_received
  amount_inr    INTEGER DEFAULT 0,                     -- rupees paid (0 for gifts/coupons)
  coins         INTEGER DEFAULT 0,                     -- coins involved (negative = deducted)
  description   TEXT,
  reference_id  TEXT,                                  -- payment provider ref or gift_transaction id
  status        TEXT NOT NULL DEFAULT 'completed',     -- pending, completed, failed, refunded
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- 3. GIFT_TRANSACTIONS
CREATE TABLE IF NOT EXISTS gift_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_id       TEXT NOT NULL,                         -- gold_trophy, silver_trophy, etc.
  gift_emoji    TEXT NOT NULL,
  gift_name     TEXT NOT NULL,
  coin_cost     INTEGER NOT NULL,
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_tx_sender   ON gift_transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_gift_tx_receiver ON gift_transactions(receiver_id);

-- 4. FEEDBACK
CREATE TABLE IF NOT EXISTS feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT 'general',       -- bug_report, feature_request, general, payment_issue
  message       TEXT NOT NULL,
  rating        INTEGER CHECK (rating >= 1 AND rating <= 5),
  email         TEXT,
  status        TEXT NOT NULL DEFAULT 'open',          -- open, reviewed, resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

-- 5. SESSIONS (for session management screen)
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name   TEXT,
  device_os     TEXT,
  ip_address    TEXT,
  location      TEXT,
  refresh_token TEXT,
  is_current    BOOLEAN DEFAULT false,
  last_active   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 6. Add coin_balance column to users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'coin_balance'
  ) THEN
    ALTER TABLE users ADD COLUMN coin_balance INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 7. Add premium + soft-delete fields to users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_premium'
  ) THEN
    ALTER TABLE users ADD COLUMN is_premium BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'premium_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN premium_expires_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
END $$;
