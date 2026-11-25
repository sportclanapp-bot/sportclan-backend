-- 170 · Fix list 25 Nov 2026, items 18, 25, 32 (speed). Additive, changes no rows, safe to run twice.
-- 25: a team's matches were found by reading the whole matches table.
CREATE INDEX IF NOT EXISTS idx_matches_team_a_id ON public.matches (team_a_id) WHERE team_a_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_team_b_id ON public.matches (team_b_id) WHERE team_b_id IS NOT NULL;

-- 18: how many line-up rows each of these matches has, in one call (the server asked 100 matches at
-- a time, one after the other). { "<match id>": n }; a match with none is left out.
CREATE OR REPLACE FUNCTION public.match_participant_counts(p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(match_id, n), '{}'::jsonb)
  FROM (SELECT match_id, count(*) AS n FROM match_participants WHERE match_id = ANY (p_ids) GROUP BY match_id) c;
$$;
REVOKE ALL ON FUNCTION public.match_participant_counts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_participant_counts(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_participant_counts(uuid[]) TO service_role;

-- 32: the Services cards' numbers by account type in one call, with the lists' own filters
-- (services.routes.ts): not deleted or suspended, not blocked either way, "Who can find you",
-- no test accounts for a real viewer, one city when given. { "<account type>": n }.
CREATE OR REPLACE FUNCTION public.services_type_counts(p_viewer uuid, p_city uuid, p_hide_test boolean) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(account_type, n), '{}'::jsonb)
  FROM (
    SELECT a.account_type, count(*) AS n
    FROM user_account_types a
    JOIN users u ON u.id = a.user_id
    WHERE u.deleted_at IS NULL AND u.suspended_at IS NULL
      AND (p_city IS NULL OR u.city_id = p_city)
      AND (NOT p_hide_test OR u.is_test_seed = false)
      AND (u.discoverability IS NULL OR u.discoverability = 'everyone' OR u.id = p_viewer
           OR (u.discoverability = 'followers' AND EXISTS (SELECT 1 FROM follow_relationships f WHERE f.follower_id = p_viewer AND f.following_id = u.id)))
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = p_viewer AND b.blocked_id = u.id) OR (b.blocked_id = p_viewer AND b.blocker_id = u.id))
    GROUP BY a.account_type
  ) c;
$$;
REVOKE ALL ON FUNCTION public.services_type_counts(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.services_type_counts(uuid, uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.services_type_counts(uuid, uuid, boolean) TO service_role;
