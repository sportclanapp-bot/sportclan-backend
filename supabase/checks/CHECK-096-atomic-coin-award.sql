-- ===========================================================================
-- CHECK-096 · award_coin_event (run after 096). Reads only; block 3 writes
-- inside a transaction that is ROLLED BACK, so nothing persists.
-- Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · The function exists with the expected signature.
-- Expected: one row, args "p_user_id uuid, p_event_type text, p_coins integer,
-- p_description text, p_tx_type text DEFAULT 'coins_earned'::text".
-- ---------------------------------------------------------------------------
SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS result
FROM pg_proc WHERE proname = 'award_coin_event';


-- ---------------------------------------------------------------------------
-- BLOCK 2 · No balance is negative. Expected: 0.
-- ---------------------------------------------------------------------------
SELECT count(*) AS negative_balances FROM users WHERE coin_balance < 0;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Behaviour, on QA account A. Nothing persists: the block always ends
-- by raising, which rolls back everything it did.
-- Expected: ERROR "CHECK-096 PASS · award +5, repeat no-op, clawback floored to 0"
-- Anything else (a FAIL message or another error) means the function is wrong.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a UUID := (SELECT id FROM users WHERE username = 'qadev_a_qa');
  start_bal INTEGER := (SELECT coin_balance FROM users WHERE username = 'qadev_a_qa');
  r1 RECORD; r2 RECORD; r3 RECORD;
BEGIN
  SELECT * INTO r1 FROM award_coin_event(a, 'check096_award', 5, 'CHECK-096', 'coins_earned');
  SELECT * INTO r2 FROM award_coin_event(a, 'check096_award', 5, 'CHECK-096', 'coins_earned');
  SELECT * INTO r3 FROM award_coin_event(a, 'check096_claw', -1000, 'CHECK-096', 'coins_reversed');
  IF r1.awarded AND r1.applied = 5 AND r1.new_balance = start_bal + 5
     AND NOT r2.awarded AND r2.new_balance = start_bal + 5
     AND r3.awarded AND r3.applied = -(start_bal + 5) AND r3.new_balance = 0 THEN
    RAISE EXCEPTION 'CHECK-096 PASS · award +5, repeat no-op, clawback floored to 0';
  END IF;
  RAISE EXCEPTION 'CHECK-096 FAIL · r1=% r2=% r3=% start=%', r1, r2, r3, start_bal;
END $$;
