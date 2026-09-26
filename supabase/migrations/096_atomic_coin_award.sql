-- ===========================================================================
-- 096 · APPLY · one atomic, floored coin award (visual review B01: V074, V254)
--
-- THE BUG. utils/coins.ts:awardCoins did three separate writes:
--   1. INSERT coin_events (the idempotency key)
--   2. RPC increment_coins (an unconditional add — no floor, 024)
--   3. INSERT transactions (what the Wallet shows)
-- If step 2 failed, the ledger said "+5" that the balance never got, and a
-- later void clawed back 5 real coins for it. The clawback's floor was a
-- non-atomic read in TypeScript (winCoins.ts), so a void racing a gift spend
-- could still take a balance below zero.
--
-- THE FIX. award_coin_event does all three in ONE transaction, under a row lock
-- on the user, and a negative amount is clamped to what the user actually has.
-- The ledger and the history record the amount REALLY applied, so a later
-- restore gives back exactly that. increment_coins is left in place for the
-- other callers (gifts/kudos), unchanged.
--
-- The backend falls back to the old path while this function doesn't exist,
-- so the deploy is safe in either order. Apply it before or right after BE-1.
--
-- Each block runs on its own. Block 1 only reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only). Expected: negative_balances = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM users WHERE coin_balance < 0)                          AS negative_balances,
  (SELECT count(*) FROM coin_events WHERE event_type LIKE 'win_match_%')       AS win_coin_ledger_rows,
  (SELECT count(*) FROM pg_proc WHERE proname = 'award_coin_event')            AS function_already_exists;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Create the function. Idempotent (CREATE OR REPLACE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_coin_event(
  p_user_id     UUID,
  p_event_type  TEXT,
  p_coins       INTEGER,
  p_description TEXT,
  p_tx_type     TEXT DEFAULT 'coins_earned'
)
RETURNS TABLE(awarded BOOLEAN, applied INTEGER, new_balance INTEGER) AS $$
DECLARE
  v_balance INTEGER;
  v_applied INTEGER;
BEGIN
  -- Lock the user's row first: every award for this user serialises here, so
  -- the floor below can't be beaten by a concurrent spend.
  SELECT coin_balance INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 0;
    RETURN;
  END IF;

  -- A clawback takes at most what the user still has.
  v_applied := CASE WHEN p_coins < 0 THEN -LEAST(-p_coins, GREATEST(v_balance, 0)) ELSE p_coins END;

  -- The idempotency key. Already awarded → no-op, report the balance.
  INSERT INTO coin_events (user_id, event_type, coins)
  VALUES (p_user_id, p_event_type, v_applied)
  ON CONFLICT (user_id, event_type) DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, v_balance;
    RETURN;
  END IF;

  UPDATE users SET coin_balance = GREATEST(0, coin_balance + v_applied)
  WHERE id = p_user_id
  RETURNING coin_balance INTO v_balance;

  INSERT INTO transactions (user_id, type, coins, description, status)
  VALUES (p_user_id, p_tx_type, v_applied, COALESCE(p_description, p_event_type), 'completed');

  RETURN QUERY SELECT TRUE, v_applied, v_balance;
END;
$$ LANGUAGE plpgsql;
