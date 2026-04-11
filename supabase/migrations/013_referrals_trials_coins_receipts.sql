-- Migration 013 — batch-3 UX upgrades:
--   * Referral system (batch 38)
--   * Premium trial flag (batch 40)
--   * Coin event ledger (batch 39)
--   * Message read receipts (batch 36 — safety net; column may already
--     exist from earlier schema work, guarded by IF NOT EXISTS)
-- All additive and idempotent.

-- ─── Batch 38: Referrals ───────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- ─── Batch 40: Premium trial ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT false;

-- ─── Batch 39: Coin events ledger ───────────────────────────────────────────
-- One row per (user, event_type). The UNIQUE constraint is what gives
-- awardCoins its idempotency — callers pass a stable event_type like
-- "win_match_{matchId}" or "community_post_{date}_{n}".
CREATE TABLE IF NOT EXISTS coin_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  coins       INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_coin_events_user ON coin_events(user_id);

-- ─── Batch 36: Read receipts safety net ────────────────────────────────────
-- messages.read_by was introduced earlier out-of-band. This statement is a
-- no-op if the column is already there.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by UUID[] NOT NULL DEFAULT '{}';
