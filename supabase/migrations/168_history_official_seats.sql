-- 168 · Q58 (Step 3, Dipak chose B, 21 Nov 2026) · N-R7-S87: assistant referees, the fourth official
-- and every other named seat (match_officials) see the match in their history with their role; only
-- the main official (matches.umpire_id) counts it in officiated_count. match_history_page (164's body)
-- gains a `seat` per match: null for a player and the main official, else the seat's role; a page item
-- says it ('seat'), its 'role' stays 'officiated' so an older app shows it as before. Requested by
-- lane A (test-plan/source/step3/claims/SQL_REQUEST.md). Replaces one function; no row changes.
CREATE OR REPLACE FUNCTION match_history_page(
  p_user uuid, p_offset integer, p_limit integer, p_q text DEFAULT NULL, p_hide_voided boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH mine AS (
    SELECT mp.match_id AS id, mp.team_side AS side, 1 AS played, NULL::text AS seat FROM match_participants mp WHERE mp.user_id = p_user
    UNION ALL
    SELECT m.id, NULL, 0, NULL FROM matches m WHERE m.umpire_id = p_user
    UNION ALL -- 168 / Q58: a named seat (assistant referee, fourth official, line judge…) — listed, not counted
    SELECT mo.match_id, NULL, 0, mo.role FROM match_officials mo WHERE mo.user_id = p_user AND mo.removed_at IS NULL
  ),
  uniq AS ( -- played wins over officiated if both were ever true of one match; then the main official, then a seat
    SELECT DISTINCT ON (id) id, side, played, seat FROM mine ORDER BY id, played DESC, (seat IS NULL) DESC, seat
  ),
  hist AS (
    SELECT u.id, u.side, u.played, u.seat, m.status, m.voided_at, m.is_ranked,
           COALESCE(m.completed_at, m.updated_at, m.scheduled_at) AS at,
           m.team_a_name, m.team_b_name, m.team_a_id, m.team_b_id,
           -- a bye: one side has a team and the other none, in a tournament (or named BYE)
           ((m.team_a_id IS NULL) <> (m.team_b_id IS NULL)
             AND (m.tournament_id IS NOT NULL OR 'BYE' IN (COALESCE(m.team_a_name, ''), COALESCE(m.team_b_name, '')))) AS bye,
           -- N-R4-3: what the Profile counted — the result's own list, else ranked or two or more real players
           (CASE WHEN jsonb_typeof(m.score_summary -> 'attributed_user_ids') = 'array'
                 THEN (m.score_summary -> 'attributed_user_ids') ? p_user::text
                 ELSE COALESCE(m.is_ranked, false) OR (SELECT count(*) FROM match_participants p WHERE p.match_id = m.id) >= 2 END)
           -- 164 / N-R7-S159: an organiser's decision ('result stands', 'awarded') or a walkover is on nobody's record
           AND COALESCE(m.score_summary ->> 'walkover', '') <> 'true'
           AND COALESCE(m.score_summary -> 'decision' ->> 'kind', '') NOT IN ('stands', 'awarded') AS real_game
    FROM uniq u JOIN matches m ON m.id = u.id
    -- 164 / N-R7-S158: a match voided while live (still 'live', with voided_at) is listed too
    WHERE m.status IN ('completed', 'abandoned') OR m.voided_at IS NOT NULL
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
    SELECT id, side, played, seat, at FROM shown ORDER BY at DESC NULLS LAST, id LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    -- 162 / N-R7-162: Played is every finished game the list shows as played; counted_count is the record's (N-R4-3)
    'played_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL AND NOT bye),
    'counted_count', (SELECT count(*) FROM hist WHERE played = 1 AND status = 'completed' AND voided_at IS NULL AND NOT bye AND real_game),
    -- 168 / Q58: only the main official counts it; a named seat is listed with its role, not counted
    'officiated_count', (SELECT count(*) FROM hist WHERE played = 0 AND seat IS NULL AND status = 'completed' AND voided_at IS NULL AND NOT bye),
    'voided_count', (SELECT count(*) FROM named WHERE voided_at IS NOT NULL),
    'total', (SELECT count(*) FROM shown),
    'page', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'side', side, 'role', CASE WHEN played = 1 THEN 'played' ELSE 'officiated' END, 'seat', seat) ORDER BY at DESC NULLS LAST, id) FROM page), '[]'::jsonb)
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
