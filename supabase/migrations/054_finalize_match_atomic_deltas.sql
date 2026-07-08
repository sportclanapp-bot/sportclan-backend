-- 054: finalize_match applies per-player DELTAS additively (SC-131, HIGH).
-- 051 wrote ABSOLUTE values computed from a JS read of the profile, so two
-- concurrent completions of a player's DIFFERENT matches both read mp=N and both
-- wrote N+1 → one lost (stress: 7/8 lost stat+rating). This recreates finalize_match
-- to apply deltas/increments against the CURRENT row under a FOR UPDATE lock, so
-- concurrent completions each build on the other (nothing lost). ELO math stays in
-- JS (calculateElo unchanged) — only persistence changes from absolute→additive.
--   * Per-profile FOR UPDATE serializes a player's concurrent completions and yields
--     the EXACT pre-update rating for rating_history (correct even when the floor clamps).
--   * Profiles are processed in DETERMINISTIC user_id order → no deadlock when a
--     completion touches both teams and two completions share players.
--   * SC-124 status-CAS on the match row preserved (applied:false on a 2nd complete).
-- The JS payload is a SUPERSET (absolute + delta fields), so this is drop-in with the
-- old function for the deploy window; the fix activates on apply.
--
-- p_results.profiles shape (054 reads the *_inc / rating_delta fields):
--   [{ user_id, sport_id, rating_delta, win_inc, loss_inc, draw_inc }]
--
-- 053 was the prior migration → this is 054.

-- Preflight (SC-116): confirm the columns this RPC writes exist.
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='user_sport_profiles' AND column_name IN ('user_id','sport_id','rating','matches_played','wins','losses','draws','last_match_at','updated_at'))
   OR (table_name='rating_history'      AND column_name IN ('user_id','sport_id','match_id','old_rating','new_rating','delta'))
   OR (table_name='matches'             AND column_name IN ('status','winner_team_id','updated_at'))
ORDER BY table_name, column_name;

CREATE OR REPLACE FUNCTION finalize_match(p_match_id uuid, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
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
    VALUES (v_uid, v_sport, p_match_id, v_old, v_new, v_delta);
  END LOOP;

  UPDATE matches
     SET status = 'completed', winner_team_id = v_winner, updated_at = v_now
   WHERE id = p_match_id
   RETURNING * INTO v_match;

  RETURN jsonb_build_object('applied', true, 'match', to_jsonb(v_match));
END;
$$;
