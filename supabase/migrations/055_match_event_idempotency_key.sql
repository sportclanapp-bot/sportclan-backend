-- 055: durable idempotency key for scoring events (SC-129, G2 slow-retry).
-- record_match_event (049) dedups via a 3s advisory-lock window — catches fast
-- double-taps + concurrent submits, but a NETWORK-TIMEOUT retry >3s later records a
-- 2nd event → score inflation. Fix (same pattern as send_gift 052 / create_post_capped
-- 053): a per-tap client_key. A retry carries the SAME key → maps to the existing
-- event at ANY age; a deliberate identical scoring action later = new tap = new key =
-- new event (legit repeated scoring preserved). The 3s no-key backstop STAYS for
-- double-taps until the FE sends keys.
--
-- 054 was the prior migration → this is 055.

-- ── PREFLIGHT 1 (SC-116): confirm the columns record_match_event writes exist.
-- Expect 7 rows: match_id, event_type, period, clock_seconds, payload, created_by, created_at.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'match_events'
  AND column_name IN ('match_id','event_type','period','clock_seconds','payload','created_by','created_at')
ORDER BY column_name;

-- ── PREFLIGHT 2 (053 lesson): confirm the CURRENT record_match_event signature before DROP.
-- Expect ONE row, 7 args: p_match_id uuid, p_created_by uuid, p_event_type text,
--   p_period integer, p_clock_seconds integer, p_payload jsonb, p_window_seconds integer
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'record_match_event';

-- ── Idempotency-key column + partial unique index (scoped to the scorer).
ALTER TABLE match_events ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_events_scorer_client_key
  ON match_events (created_by, client_key) WHERE client_key IS NOT NULL;

-- ── DROP the old 7-arg function FIRST (adding a param changes the signature; keeping
--    both would make a 7-arg call ambiguous). Matches PREFLIGHT 2's signature.
DROP FUNCTION IF EXISTS record_match_event(uuid, uuid, text, integer, integer, jsonb, integer);

CREATE OR REPLACE FUNCTION record_match_event(
  p_match_id       uuid,
  p_created_by     uuid,
  p_event_type     text,
  p_period         integer,
  p_clock_seconds  integer,
  p_payload        jsonb,
  p_window_seconds integer DEFAULT 3,
  p_client_key     uuid    DEFAULT NULL
) RETURNS match_events
LANGUAGE plpgsql
AS $$
DECLARE
  v_row match_events;
BEGIN
  -- serialize concurrent submits for this match (released at xact end)
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::text));

  -- KEY path (SC-129): a retry carries the same client_key → the existing event, at ANY age.
  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM match_events
      WHERE created_by = p_created_by AND client_key = p_client_key
      LIMIT 1;
    IF FOUND THEN RETURN v_row; END IF;
  ELSE
    -- No-key BACKSTOP (049, UNCHANGED): identical event from the same scorer within the window.
    SELECT * INTO v_row FROM match_events
      WHERE match_id = p_match_id
        AND created_by = p_created_by
        AND event_type = p_event_type
        AND COALESCE(period, -1) = COALESCE(p_period, -1)
        AND COALESCE(clock_seconds, -1) = COALESCE(p_clock_seconds, -1)
        AND COALESCE(payload, '{}'::jsonb) = COALESCE(p_payload, '{}'::jsonb)
        AND created_at > now() - (GREATEST(p_window_seconds, 0) * interval '1 second')
      ORDER BY created_at DESC
      LIMIT 1;
    IF FOUND THEN RETURN v_row; END IF;
  END IF;

  BEGIN
    INSERT INTO match_events (match_id, event_type, period, clock_seconds, payload, created_by, client_key)
    VALUES (p_match_id, p_event_type, p_period, p_clock_seconds, p_payload, p_created_by, p_client_key)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- concurrent same-key insert across matches won the race → return the existing (not a 500).
    SELECT * INTO v_row FROM match_events
      WHERE created_by = p_created_by AND client_key = p_client_key
      LIMIT 1;
  END;

  RETURN v_row;
END;
$$;
