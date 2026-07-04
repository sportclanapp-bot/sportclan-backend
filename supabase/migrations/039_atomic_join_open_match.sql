-- 039: atomic open-match join (SC-59 — oversell fix).
-- The controller previously read (is_open, players_needed), checked capacity in
-- JS, inserted a participant, then wrote players_needed = max(0, needed-1) back
-- from that STALE snapshot. N concurrent joins all read the same snapshot, all
-- passed the check, all inserted, and each wrote the same decremented value —
-- so a match's open player slots could be oversold without bound, players_needed
-- underflowed toward a meaningless number, and is_open never flipped to false.
--
-- This function performs the capacity check + participant insert + decrement in
-- ONE transaction, taking a row lock on the match (SELECT ... FOR UPDATE) so all
-- concurrent joins for the same match SERIALIZE. At most players_needed joins can
-- ever succeed; once it reaches 0 the match is closed and further joins get
-- 'full'. This mirrors the coin economy's race-safe RPC pattern (030).
--
-- Returns (status, players_needed). status is one of:
--   joined / already_joined / full / not_open / not_found
-- The already-joined case is handled idempotently under the lock, so the
-- UNIQUE(match_id,user_id) constraint never surfaces a 23505 to the caller.
CREATE OR REPLACE FUNCTION join_open_match(p_match_id UUID, p_user_id UUID)
RETURNS TABLE(status TEXT, players_needed INT) AS $$
DECLARE
  v_is_open BOOLEAN;
  v_status TEXT;
  v_needed INT;
BEGIN
  -- Lock the match row; concurrent joins to the same match queue behind this.
  SELECT m.is_open, m.status, m.players_needed
    INTO v_is_open, v_status, v_needed
  FROM matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::INT;
    RETURN;
  END IF;

  -- Idempotent: already joined -> success, no capacity change.
  IF EXISTS (
    SELECT 1 FROM match_participants
    WHERE match_id = p_match_id AND user_id = p_user_id
  ) THEN
    RETURN QUERY SELECT 'already_joined'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  -- Ended matches (completed/cancelled) are not joinable.
  IF v_status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT 'not_open'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  -- No slots left -> full (distinct from an explicitly-closed match).
  IF COALESCE(v_needed, 0) <= 0 THEN
    RETURN QUERY SELECT 'full'::TEXT, 0;
    RETURN;
  END IF;

  IF v_is_open IS NOT TRUE THEN
    RETURN QUERY SELECT 'not_open'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  -- Capacity confirmed under the lock: insert and decrement atomically.
  INSERT INTO match_participants (match_id, user_id, team_side)
  VALUES (p_match_id, p_user_id, 'A');

  v_needed := v_needed - 1;

  UPDATE matches
  SET players_needed = v_needed,
      is_open = (v_needed > 0),
      updated_at = now()
  WHERE id = p_match_id;

  RETURN QUERY SELECT 'joined'::TEXT, v_needed;
END;
$$ LANGUAGE plpgsql;
