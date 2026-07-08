-- 056: record_match_event returns {event, was_new} so the caller can skip the
-- fan-out on a dedup-hit (SC-133). SC-129 dedups a retried scoring event to ONE
-- event row, but createEvent fired fanoutScoreUpdate on every request (the 055
-- function returned the row on BOTH the insert and the dedup paths, with no signal)
-- → 2 notifications for 1 event. Now the RPC reports was_new; createEvent fans out
-- only when was_new = true. Body is otherwise IDENTICAL to 055 (advisory lock, key
-- path, 3s backstop, unique_violation→existing all preserved).
--
-- The return TYPE changes (match_events → jsonb), so CREATE OR REPLACE can't do it —
-- DROP + CREATE (the 053 lesson). JS parses both shapes (raw row → was_new=true), so
-- deploying JS ahead of this migration is safe: pre-056 it behaves exactly as today
-- (no missed notifications); applying 056 activates the skip.
--
-- 055 was the prior migration → this is 056.

-- ── PREFLIGHT 1 (SC-116): confirm the columns record_match_event writes exist.
-- Expect: match_id, event_type, period, clock_seconds, payload, created_by, created_at, client_key.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'match_events'
  AND column_name IN ('match_id','event_type','period','clock_seconds','payload','created_by','created_at','client_key')
ORDER BY column_name;

-- ── PREFLIGHT 2 (053 lesson): confirm the CURRENT signature + return type before DROP.
-- Expect ONE row: 8 args (…, p_window_seconds integer, p_client_key uuid) RETURNS 'match_events'.
SELECT proname,
       pg_get_function_identity_arguments(oid) AS args,
       pg_get_function_result(oid)             AS returns
FROM pg_proc WHERE proname = 'record_match_event';

-- ── DROP the 8-arg function (return type changes match_events → jsonb).
DROP FUNCTION IF EXISTS record_match_event(uuid, uuid, text, integer, integer, jsonb, integer, uuid);

CREATE OR REPLACE FUNCTION record_match_event(
  p_match_id       uuid,
  p_created_by     uuid,
  p_event_type     text,
  p_period         integer,
  p_clock_seconds  integer,
  p_payload        jsonb,
  p_window_seconds integer DEFAULT 3,
  p_client_key     uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row     match_events;
  v_was_new boolean := false;
BEGIN
  -- serialize concurrent submits for this match (released at xact end)
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::text));

  -- KEY path (SC-129): a retry carries the same client_key → the existing event, at ANY age.
  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM match_events
      WHERE created_by = p_created_by AND client_key = p_client_key
      LIMIT 1;
    -- dedup-hit → NOT new (SC-133: caller skips the fan-out)
    IF FOUND THEN RETURN jsonb_build_object('event', to_jsonb(v_row), 'was_new', false); END IF;
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
    -- backstop dedup-hit → NOT new
    IF FOUND THEN RETURN jsonb_build_object('event', to_jsonb(v_row), 'was_new', false); END IF;
  END IF;

  BEGIN
    INSERT INTO match_events (match_id, event_type, period, clock_seconds, payload, created_by, client_key)
    VALUES (p_match_id, p_event_type, p_period, p_clock_seconds, p_payload, p_created_by, p_client_key)
    RETURNING * INTO v_row;
    v_was_new := true;  -- fresh insert → NEW (the ONLY was_new=true path)
  EXCEPTION WHEN unique_violation THEN
    -- concurrent same-key insert across matches won the race → return the existing (not a 500).
    SELECT * INTO v_row FROM match_events
      WHERE created_by = p_created_by AND client_key = p_client_key
      LIMIT 1;
    v_was_new := false;  -- lost the race → dedup-hit, NOT new
  END;

  RETURN jsonb_build_object('event', to_jsonb(v_row), 'was_new', v_was_new);
END;
$$;
