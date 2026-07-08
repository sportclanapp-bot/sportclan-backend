-- 051: finalize_match — atomic completion of a match (SC-126 / SC-124-labelled).
-- completeMatch applied ELO, then set status LAST via separate statements; a
-- mid-op failure/timeout left ELO applied with status still 'live' → a retry
-- double-applied ELO (proven live in G1: rating 1200→1216, mp 0→1, status=scheduled;
-- retry → 1230.53, mp=2). This RPC writes the whole core in ONE transaction.
--
-- Option B: the ELO math stays in JS (E1-verified); JS passes pre-computed absolute
-- values here. The function body is one implicit transaction — any failure rolls
-- back ALL writes, so the match stays not-completed (cleanly retryable), never
-- half-committed. A `FOR UPDATE` + terminal-status re-check inside the txn is the
-- compare-and-swap that preserves the AUDIT-2 no-double-apply property under
-- concurrent/retried completes.
--
-- 049 (record_match_event) + 050 (scheduled_at index) are already staged → this is 051.
--
-- p_results shape:
--   { "winner_team_id": uuid|null, "now": timestamptz,
--     "profiles":       [{user_id, sport_id, rating, matches_played, wins, losses, draws}],  -- NEW absolute values
--     "rating_history": [{user_id, sport_id, match_id, old_rating, new_rating, delta}] }
-- returns { "applied": bool, "match": <matches row> }

-- Preflight (SC-116 lesson): confirm the columns this RPC writes actually exist.
-- Expect user_sport_profiles + rating_history + matches rows.
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
BEGIN
  -- CAS: lock the match + re-check it's still non-terminal (AUDIT-2 property).
  SELECT status INTO v_status FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'finalize_match: match % not found', p_match_id;
  END IF;
  IF v_status IN ('completed','abandoned','cancelled') THEN
    SELECT * INTO v_match FROM matches WHERE id = p_match_id;
    RETURN jsonb_build_object('applied', false, 'match', to_jsonb(v_match));
  END IF;

  -- Upsert each player's new absolute profile values (folds create-missing + update).
  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(p_results->'profiles', '[]'::jsonb))
  LOOP
    INSERT INTO user_sport_profiles
      (user_id, sport_id, rating, matches_played, wins, losses, draws, last_match_at, updated_at)
    VALUES
      ((p->>'user_id')::uuid, (p->>'sport_id')::uuid, (p->>'rating')::numeric,
       (p->>'matches_played')::int, (p->>'wins')::int, (p->>'losses')::int, (p->>'draws')::int,
       v_now, v_now)
    ON CONFLICT (user_id, sport_id) DO UPDATE SET
      rating         = EXCLUDED.rating,
      matches_played = EXCLUDED.matches_played,
      wins           = EXCLUDED.wins,
      losses         = EXCLUDED.losses,
      draws          = EXCLUDED.draws,
      last_match_at  = EXCLUDED.last_match_at,
      updated_at     = EXCLUDED.updated_at;
  END LOOP;

  -- Insert rating history.
  IF jsonb_array_length(COALESCE(p_results->'rating_history', '[]'::jsonb)) > 0 THEN
    INSERT INTO rating_history (user_id, sport_id, match_id, old_rating, new_rating, delta)
    SELECT (r->>'user_id')::uuid, (r->>'sport_id')::uuid, (r->>'match_id')::uuid,
           (r->>'old_rating')::numeric, (r->>'new_rating')::numeric, (r->>'delta')::numeric
    FROM jsonb_array_elements(p_results->'rating_history') r;
  END IF;

  -- Flip status → completed (the CAS above guarantees exactly one caller reaches here).
  UPDATE matches
     SET status = 'completed', winner_team_id = v_winner, updated_at = v_now
   WHERE id = p_match_id
   RETURNING * INTO v_match;

  RETURN jsonb_build_object('applied', true, 'match', to_jsonb(v_match));
END;
$$;
