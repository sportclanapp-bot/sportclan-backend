-- 030: atomic coin deduction with a balance floor.
-- Fixes A4-005 — the gift send path read the balance, checked it, then deducted
-- via increment_coins (an unconditional add). Two concurrent sends could both
-- pass the check and both deduct, driving coin_balance negative / double-spending.
-- This conditional UPDATE performs the check + decrement in one statement, so at
-- most one racing request succeeds; the other sees an insufficient balance.
--
-- Returns the new balance, or NULL when the balance was insufficient (no row
-- matched the `coin_balance >= amount` predicate). `amount` is positive (the cost).
CREATE OR REPLACE FUNCTION deduct_coins_if_sufficient(target_user_id UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  UPDATE users
  SET coin_balance = coin_balance - amount
  WHERE id = target_user_id AND coin_balance >= amount
  RETURNING coin_balance INTO new_balance;
  RETURN new_balance; -- NULL when insufficient
END;
$$ LANGUAGE plpgsql;
