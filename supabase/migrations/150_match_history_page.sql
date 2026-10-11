-- 150 · Audit #90 (11 Oct 2026): Profile → Matches never loaded for a busy
-- account on live (31 s, then "Couldn't load results"). The server read every
-- one of the person's matches in full — 6,161 for QA B — about 75 database
-- round trips one after another, to show 20. This does the whole history in
-- one query (their matches played or officiated, finished or abandoned, newest
-- first, the counts, a name search, voided hidden or not) and returns one page
-- of ids; the server then loads just those 20.
-- Additive and safe to run twice. The index is small (only matches that have
-- an umpire) and builds in about a second on live's matches table.
CREATE INDEX IF NOT EXISTS idx_matches_umpire ON matches (umpire_id) WHERE umpire_id IS NOT NULL;

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
    SELECT u.id, u.side, u.played, m.status, m.voided_at,
           COALESCE(m.completed_at, m.updated_at, m.scheduled_at) AS at,
           m.team_a_name, m.team_b_name, m.team_a_id, m.team_b_id
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
    'played_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL),
    'officiated_count', (SELECT count(*) FROM hist WHERE played = 0 AND status = 'completed' AND voided_at IS NULL),
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
