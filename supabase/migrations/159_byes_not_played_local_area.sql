-- 159 (first part) · F189 (launch test plan, 16 Oct 2026): Match history said "Played
-- 13,348" while the Profile said 13,316 matches for the same person. The 32
-- extra were tournament byes (a round with no opponent, won without a game),
-- which match_history_page (150) counted as matches played; the Profile's count
-- (user_sport_profiles.matches_played) never had them. A bye is still listed in
-- the history, but no longer counted as played (or officiated). The rule is the
-- server's isByeMatch (src/utils/matchCounts.ts): one side has a team and the
-- other none, in a tournament (or the empty side is named BYE).
-- N-R4-3 (found while fixing F189): Played is what the Profile counted. A result
-- since Audit #56 says whose record it changed (score_summary.attributed_user_ids:
-- only players who agreed to the match, nobody for a walkover); an older one goes
-- by the Profile's rule (SC-283): ranked, or two or more real players — so you
-- against a typed-in name is listed but not played.
-- Same function, arguments and result shape as 150 (the whole function, so it
-- also stands without 150): CREATE OR REPLACE, safe to run twice.

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
    'played_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL AND NOT bye AND real_game),
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

-- 159 (second part) · F038 (launch test plan, 16 Oct 2026): sign-up asks for a
-- "Local area (optional)" (e.g. Kothrud) and the answer was thrown away — there
-- was nowhere to keep it. A nullable column, at most 80 characters (the
-- server's LIMITS.localAreaMax). Additive and safe to run twice. The server
-- reads this column on every profile, so run this BEFORE deploying the server.
ALTER TABLE users ADD COLUMN IF NOT EXISTS local_area text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_local_area_len') THEN
    ALTER TABLE users ADD CONSTRAINT users_local_area_len CHECK (local_area IS NULL OR char_length(local_area) <= 80);
  END IF;
END
$$;
