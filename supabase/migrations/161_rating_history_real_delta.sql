-- ===========================================================================
-- 161 · N-R7-137 (Step 2, Batch 8, 6 Nov 2026) · rating_history.delta is the real change
--
-- finalize_match (054) wrote the Elo delta asked for, not the change made: a 105 player losing
-- 8 points stops at the 100 floor, but the row said old 105, new 100, delta -8. The profile line
-- read "after 1 rated match (-8)", and a void reversed -8 (100 + 8 = 108, not back to 105).
-- This recreates finalize_match (054 body, one line changed) to store new - old, and corrects the
-- rows already written that way (only where the floor cut the delta), except voided matches,
-- whose void already reversed the stored value (restoring one re-applies that same value).
-- Safe to run twice (a second run changes 0 rows).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.finalize_match(p_match_id uuid, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status text;
  v_now    timestamptz := COALESCE((p_results->>'now')::timestamptz, now());
  v_winner uuid := NULLIF(p_results->>'winner_team_id','')::uuid;
  v_match  matches;
  p        jsonb;
  v_uid    uuid;
  v_sport  uuid;
  v_delta  numeric;
  v_win    int;
  v_loss   int;
  v_draw   int;
  v_old    numeric;
  v_new    numeric;
BEGIN
  -- SC-124 CAS: lock the match + re-check it's still non-terminal (no double-apply).
  SELECT status INTO v_status FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'finalize_match: match % not found', p_match_id;
  END IF;
  IF v_status IN ('completed','abandoned','cancelled') THEN
    SELECT * INTO v_match FROM matches WHERE id = p_match_id;
    RETURN jsonb_build_object('applied', false, 'match', to_jsonb(v_match));
  END IF;

  -- SC-131: apply per-player DELTAS additively, in DETERMINISTIC user_id order.
  FOR p IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_results->'profiles', '[]'::jsonb)) value
    ORDER BY value->>'user_id'
  LOOP
    v_uid   := (p->>'user_id')::uuid;
    v_sport := (p->>'sport_id')::uuid;
    v_delta := COALESCE((p->>'rating_delta')::numeric, 0);
    v_win   := COALESCE((p->>'win_inc')::int, 0);
    v_loss  := COALESCE((p->>'loss_inc')::int, 0);
    v_draw  := COALESCE((p->>'draw_inc')::int, 0);

    -- Ensure the profile exists (default rating) so the FOR UPDATE below locks a row.
    INSERT INTO user_sport_profiles (user_id, sport_id)
    VALUES (v_uid, v_sport)
    ON CONFLICT (user_id, sport_id) DO NOTHING;

    -- Lock + read the EXACT current rating (serializes this player's concurrent completions).
    SELECT rating INTO v_old FROM user_sport_profiles
      WHERE user_id = v_uid AND sport_id = v_sport FOR UPDATE;

    v_new := GREATEST(100, v_old + v_delta);

    UPDATE user_sport_profiles SET
      rating         = v_new,
      matches_played = matches_played + 1,
      wins           = wins   + v_win,
      losses         = losses + v_loss,
      draws          = draws  + v_draw,
      last_match_at  = v_now,
      updated_at     = v_now
    WHERE user_id = v_uid AND sport_id = v_sport;

    -- rating_history with the EXACT pre-update rating (correct even under the floor clamp).
    INSERT INTO rating_history (user_id, sport_id, match_id, old_rating, new_rating, delta)
    -- 161 / N-R7-137: the change that really happened (the floor may have cut the Elo delta).
    VALUES (v_uid, v_sport, p_match_id, v_old, v_new, v_new - v_old);
  END LOOP;

  UPDATE matches
     SET status = 'completed', winner_team_id = v_winner, updated_at = v_now
   WHERE id = p_match_id
   RETURNING * INTO v_match;

  RETURN jsonb_build_object('applied', true, 'match', to_jsonb(v_match));
END;
$function$;


UPDATE public.rating_history h
SET delta = h.new_rating - h.old_rating
WHERE h.delta <> h.new_rating - h.old_rating
  AND h.new_rating = 100
  AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = h.match_id AND m.voided_at IS NOT NULL);
