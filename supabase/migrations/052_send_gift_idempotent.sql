-- 052: send_gift — atomic, retry-idempotent gift send (SC-114 / SC-129-labelled, HIGH money).
-- sendGift's deduct_coins_if_sufficient stops CONCURRENT races but not SEQUENTIAL
-- retries: a lost-response re-tap is a valid new spend → coins deducted TWICE + 2
-- gifts (proven live: balance 60→30, 2 rows). Fix (approach a): an idempotency key
-- (unique per client tap) dedups retries (same key → original result, no 2nd deduct)
-- while deliberate re-gifts (new tap = new key) still go through — correct for money,
-- since gifts are legitimately repeatable in rapid succession.
--
-- Backstop: until the FE sends keys, a no-key send falls back to a SHORT (~1.5s)
-- identical-gift window so a near-instant network retry is still caught; a deliberate
-- rapid re-gift is unlikely to collide with 1.5s. The key path takes over once the FE ships.
--
-- 049/050/051 are the prior migrations → this is 052.

-- Preflight (SC-116 lesson): confirm the columns this RPC touches exist.
-- Expect gift_transactions (7) + transactions (5) rows.
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='gift_transactions' AND column_name IN ('sender_id','receiver_id','gift_id','gift_emoji','gift_name','coin_cost','message'))
   OR (table_name='transactions'      AND column_name IN ('user_id','type','coins','description','reference_id'))
ORDER BY table_name, column_name;

-- Idempotency key column + a partial unique index (only enforced when a key is present,
-- so legacy no-key rows are unaffected).
ALTER TABLE gift_transactions ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_transactions_sender_client_key
  ON gift_transactions (sender_id, client_key) WHERE client_key IS NOT NULL;

CREATE OR REPLACE FUNCTION send_gift(
  p_sender          uuid,
  p_receiver        uuid,
  p_gift_id         text,
  p_emoji           text,
  p_name            text,
  p_cost            integer,
  p_message         text,
  p_client_key      uuid,
  p_backstop_seconds numeric DEFAULT 1.5
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_gift gift_transactions;
  v_bal  integer;
BEGIN
  -- ── DEDUP ──────────────────────────────────────────────────────────────
  IF p_client_key IS NOT NULL THEN
    -- Idempotency-key path: claim the key by inserting first. A retry/concurrent
    -- send with the SAME key hits the unique index → return the original, no deduct.
    BEGIN
      INSERT INTO gift_transactions
        (sender_id, receiver_id, gift_id, gift_emoji, gift_name, coin_cost, message, client_key)
      VALUES (p_sender, p_receiver, p_gift_id, p_emoji, p_name, p_cost, p_message, p_client_key)
      RETURNING * INTO v_gift;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_gift FROM gift_transactions
        WHERE sender_id = p_sender AND client_key = p_client_key LIMIT 1;
      SELECT coin_balance INTO v_bal FROM users WHERE id = p_sender;
      RETURN jsonb_build_object('status','duplicate','gift',to_jsonb(v_gift),'new_balance',v_bal);
    END;
  ELSE
    -- No-key BACKSTOP: an identical gift within the short window = a retry.
    SELECT * INTO v_gift FROM gift_transactions
      WHERE sender_id = p_sender AND receiver_id = p_receiver AND gift_id = p_gift_id
        AND created_at > now() - (GREATEST(p_backstop_seconds, 0) * interval '1 second')
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      SELECT coin_balance INTO v_bal FROM users WHERE id = p_sender;
      RETURN jsonb_build_object('status','duplicate','gift',to_jsonb(v_gift),'new_balance',v_bal);
    END IF;
    INSERT INTO gift_transactions
      (sender_id, receiver_id, gift_id, gift_emoji, gift_name, coin_cost, message, client_key)
    VALUES (p_sender, p_receiver, p_gift_id, p_emoji, p_name, p_cost, p_message, NULL)
    RETURNING * INTO v_gift;
  END IF;

  -- ── DEDUCT (atomic conditional, same floor as deduct_coins_if_sufficient) ──
  UPDATE users SET coin_balance = coin_balance - p_cost
    WHERE id = p_sender AND coin_balance >= p_cost
    RETURNING coin_balance INTO v_bal;
  IF NOT FOUND THEN
    -- insufficient → undo the claimed gift row (never leave a gift without a deduct)
    DELETE FROM gift_transactions WHERE id = v_gift.id;
    RETURN jsonb_build_object('status','insufficient');
  END IF;

  -- ── LEDGER ──
  INSERT INTO transactions (user_id, type, coins, description, reference_id, status) VALUES
    (p_sender,   'gift_sent',     -p_cost, 'Sent '     || p_name || ' ' || p_emoji, v_gift.id::text, 'completed'),
    (p_receiver, 'gift_received',  0,      'Received ' || p_name || ' ' || p_emoji, v_gift.id::text, 'completed');

  RETURN jsonb_build_object('status','sent','gift',to_jsonb(v_gift),'new_balance',v_bal);
END;
$$;
