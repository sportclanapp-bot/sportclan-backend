-- 162 · N-R7-162 (Step 2, Batch 8, OBS-A5-1, 6 Nov 2026): Match history's header said "Played 2"
-- over a list of 109 finished games: since 159 (N-R4-3) Played counted only the games on the
-- person's record (the result's attributed_user_ids, else ranked or two or more real players), while
-- the list shows every game they played. Played is now every finished game the list shows as played
-- (not voided, not a bye); the record's number moves to a new field, counted_count.
-- Same function, arguments and result shape as 159 plus one key: CREATE OR REPLACE, safe to run twice.
-- Changes no rows.

CREATE OR REPLACE FUNCTION match_history_page(
  p_user uuid, p_offset integer, p_limit integer, p_q text DEFAULT NULL, p_hide_voided boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH mine AS (
    SELECT mp.match_id AS id, mp.team_side AS side, 1 AS played FROM match_participants mp WHERE mp.user_id = p_user
    UNION ALL
    SELECT m.id, NULL, 0 FROM matches m WHERE m.umpire_id = p_user
  ),
  uniq AS ( -- played wins over officiated if both were ever true of one match
    SELECT DISTINCT ON (id) id, side, played FROM mine ORDER BY id, played DESC
  ),
  hist AS (
    SELECT u.id, u.side, u.played, m.status, m.voided_at, m.is_ranked,
           COALESCE(m.completed_at, m.updated_at, m.scheduled_at) AS at,
           m.team_a_name, m.team_b_name, m.team_a_id, m.team_b_id,
           -- a bye: one side has a team and the other none, in a tournament (or named BYE)
           ((m.team_a_id IS NULL) <> (m.team_b_id IS NULL)
             AND (m.tournament_id IS NOT NULL OR 'BYE' IN (COALESCE(m.team_a_name, ''), COALESCE(m.team_b_name, '')))) AS bye,
           -- N-R4-3: what the Profile counted — the result's own list, else ranked or two or more real players
           (CASE WHEN jsonb_typeof(m.score_summary -> 'attributed_user_ids') = 'array'
                 THEN (m.score_summary -> 'attributed_user_ids') ? p_user::text
                 ELSE COALESCE(m.is_ranked, false) OR (SELECT count(*) FROM match_participants p WHERE p.match_id = m.id) >= 2 END) AS real_game
    FROM uniq u JOIN matches m ON m.id = u.id
    WHERE m.status IN ('completed', 'abandoned')
  ),
  named AS ( -- p_q arrives with LIKE's % and _ escaped (\)
    SELECT h.* FROM hist h
    WHERE COALESCE(p_q, '') = ''
       OR h.team_a_name ILIKE '%' || p_q || '%' ESCAPE '\'
       OR h.team_b_name ILIKE '%' || p_q || '%' ESCAPE '\'
       OR EXISTS (SELECT 1 FROM teams t WHERE t.id IN (h.team_a_id, h.team_b_id) AND t.name ILIKE '%' || p_q || '%' ESCAPE '\')
  ),
  shown AS (
    SELECT * FROM named WHERE NOT COALESCE(p_hide_voided, false) OR voided_at IS NULL
  ),
  page AS (
    SELECT id, side, played, at FROM shown ORDER BY at DESC NULLS LAST, id LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    -- 162 / N-R7-162: Played is every finished game the list shows as played; counted_count is the record's (N-R4-3)
    'played_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL AND NOT bye),
    'counted_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL AND NOT bye AND real_game),
    'officiated_count', (SELECT count(*) FROM hist WHERE played = 0 AND status = 'completed' AND voided_at IS NULL AND NOT bye),
    'voided_count', (SELECT count(*) FROM named WHERE voided_at IS NOT NULL),
    'total', (SELECT count(*) FROM shown),
    'page', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'side', side, 'role', CASE WHEN played = 1 THEN 'played' ELSE 'officiated' END) ORDER BY at DESC NULLS LAST, id) FROM page), '[]'::jsonb)
  );
$$;

-- The backend calls it with the service role; the public keys get nothing (as 148).
DO $$
DECLARE pub_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO pub_roles FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  EXECUTE 'REVOKE EXECUTE ON FUNCTION match_history_page(uuid, integer, integer, text, boolean) FROM PUBLIC' || COALESCE(', ' || pub_roles, '');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION match_history_page(uuid, integer, integer, text, boolean) TO service_role';
  END IF;
END
$$;
