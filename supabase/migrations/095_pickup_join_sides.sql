-- 095 · F-08 (MATCH_CREATE_TEST_PLAN): an open pickup, fixed three ways.
--
--   1. A FULL pickup stays a pickup. join_open_match used to set is_open = false
--      on the last slot, and leaveMatch refuses anything that isn't open — so a
--      full match trapped every player in it ("You can't leave a singles match").
--      "Full" is players_needed = 0; is_open now only means "this is a pickup".
--      Every list that suggests joinable matches already filters
--      players_needed > 0, and join still answers 'full'.
--   2. Only a SCHEDULED match can be joined. The function refused only
--      completed / cancelled, so a live or abandoned match took joiners.
--   3. Sides are balanced (decision 2026-09-25): each joiner goes to the side
--      with fewer players, A on a tie. Every joiner used to land on side A, so
--      one "team" held everyone and the result meant nothing.
--
-- Same signature and statuses as 039, plus 'started'. Idempotent (CREATE OR
-- REPLACE). Pickups that filled BEFORE this migration keep is_open = false; they
-- can't be told apart from a closed match safely, so they are left alone.

CREATE OR REPLACE FUNCTION join_open_match(p_match_id UUID, p_user_id UUID)
RETURNS TABLE(status TEXT, players_needed INT) AS $$
DECLARE
  v_is_open BOOLEAN;
  v_status TEXT;
  v_needed INT;
  v_a INT;
  v_b INT;
BEGIN
  SELECT m.is_open, m.status, m.players_needed
    INTO v_is_open, v_status, v_needed
  FROM matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::INT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM match_participants
    WHERE match_id = p_match_id AND user_id = p_user_id
  ) THEN
    RETURN QUERY SELECT 'already_joined'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT 'not_open'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  IF v_status <> 'scheduled' THEN
    RETURN QUERY SELECT 'started'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  IF v_is_open IS NOT TRUE THEN
    RETURN QUERY SELECT 'not_open'::TEXT, COALESCE(v_needed, 0);
    RETURN;
  END IF;

  IF COALESCE(v_needed, 0) <= 0 THEN
    RETURN QUERY SELECT 'full'::TEXT, 0;
    RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE team_side = 'A'), COUNT(*) FILTER (WHERE team_side = 'B')
    INTO v_a, v_b
  FROM match_participants
  WHERE match_id = p_match_id;

  INSERT INTO match_participants (match_id, user_id, team_side)
  VALUES (p_match_id, p_user_id, CASE WHEN v_b < v_a THEN 'B' ELSE 'A' END);

  v_needed := v_needed - 1;

  UPDATE matches
  SET players_needed = v_needed,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN QUERY SELECT 'joined'::TEXT, v_needed;
END;
$$ LANGUAGE plpgsql;
