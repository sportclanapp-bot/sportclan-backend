-- 061: atomic open-match leave (SC-262).
-- Symmetric to join_open_match (039): a joined player withdrawing must free the
-- slot (players_needed +1, is_open=true) atomically, or concurrent leaves race
-- on a read-modify-write and lose the increment. Takes a row lock (SELECT ...
-- FOR UPDATE) so all leaves/joins for the same match serialize.
--
-- Allowed ONLY while status ∈ (scheduled, upcoming): leaving a LIVE match would
-- strand the scorecard, a completed/cancelled one is history.
--
-- The creator MAY leave as a player — created_by is immutable and independent of
-- participation, so removing a participant row never orphans the match (unlike
-- the SC-243 team-captain class).
--
-- NOTE (accepted imprecision): players_needed is a soft "still looking for N"
-- hint, NOT an invariant. A lineup-added participant (addParticipants, which
-- never decremented players_needed) leaving still bumps it by 1. Acceptable — we
-- don't track join-source, and over-counting a soft hint is harmless.
--
-- Returns (status, players_needed). status is one of:
--   left / not_participant / not_leavable / not_found
--
-- MUST be applied BEFORE the backend deploy: the /matches/:id/leave endpoint
-- calls this RPC; deploying first would 500 the leave path (PGRST202).

CREATE OR REPLACE FUNCTION leave_open_match(p_match_id UUID, p_user_id UUID)
RETURNS TABLE(status TEXT, players_needed INT) AS $$
DECLARE
  v_status TEXT;
  v_needed INT;
  v_deleted INT;
BEGIN
  -- Lock the match row; concurrent joins/leaves queue behind this.
  SELECT m.status, m.players_needed
    INTO v_status, v_needed
  FROM matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::INT;
    RETURN;
  END IF;

  -- Only a not-yet-started match can be left.
  IF v_status NOT IN ('scheduled', 'upcoming') THEN
    RETURN QUERY SELECT 'not_leavable'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  -- Remove the caller's participant row (self-leave only).
  DELETE FROM match_participants
  WHERE match_id = p_match_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN QUERY SELECT 'not_participant'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  -- Free the slot: +1 and re-open. Atomic under the lock.
  v_needed := COALESCE(v_needed, 0) + 1;

  UPDATE matches
  SET players_needed = v_needed,
      is_open = TRUE,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN QUERY SELECT 'left'::TEXT, v_needed;
END;
$$ LANGUAGE plpgsql;
