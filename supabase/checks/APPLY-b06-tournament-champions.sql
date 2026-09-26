-- ===========================================================================
-- APPLY-b06 · give completed tournaments their champion (visual review V104)
--
-- tournaments.champion_team_id (migration 060) is set by the automatic
-- crowning, but the manual "Complete tournament" path never set it, and the
-- auto path silently skips if the tournament wasn't 'live' at that moment. From
-- BE-1 on, manual Complete crowns too (tournaments.controller.ts:championOf).
--
-- This backfills BRACKET formats (knockout, groups_knockout): the champion is
-- the winner of the final = the completed, unvoided bracket match with no
-- next_match_id and no group_label. League / round-robin champions come from
-- the standings ladder, which lives in code, not SQL: block 2 lists any that
-- are missing so they can be crowned from the app's Complete path instead.
--
-- Each block runs on its own. Run 1 and 2 (read-only), then 3, then CHECK-b06.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only): bracket tournaments missing a champion,
-- and how many of them have a decided final.
-- ---------------------------------------------------------------------------
WITH missing AS (
  SELECT t.id, t.name, t.format FROM tournaments t
  WHERE t.status = 'completed' AND t.champion_team_id IS NULL
    AND COALESCE(t.format, 'knockout') NOT IN ('league', 'round_robin')
), finals AS (
  SELECT DISTINCT ON (m.tournament_id) m.tournament_id, m.winner_team_id
  FROM matches m JOIN missing x ON x.id = m.tournament_id
  WHERE m.next_match_id IS NULL AND m.group_label IS NULL AND m.status = 'completed'
    AND m.voided_at IS NULL AND m.winner_team_id IS NOT NULL
  ORDER BY m.tournament_id, m.round DESC NULLS LAST
)
SELECT (SELECT count(*) FROM missing) AS bracket_missing_champion,
       (SELECT count(*) FROM finals)  AS fixable_from_final;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Review (read-only): league / round-robin tournaments without one.
-- ---------------------------------------------------------------------------
SELECT id, name, format, updated_at FROM tournaments
WHERE status = 'completed' AND champion_team_id IS NULL AND format IN ('league', 'round_robin')
ORDER BY updated_at DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Set the champion from the final. Returns the number updated
-- (= block 1 fixable_from_final).
-- ---------------------------------------------------------------------------
WITH finals AS (
  SELECT DISTINCT ON (m.tournament_id) m.tournament_id, m.winner_team_id
  FROM matches m JOIN tournaments t ON t.id = m.tournament_id
  WHERE t.status = 'completed' AND t.champion_team_id IS NULL
    AND COALESCE(t.format, 'knockout') NOT IN ('league', 'round_robin')
    AND m.next_match_id IS NULL AND m.group_label IS NULL AND m.status = 'completed'
    AND m.voided_at IS NULL AND m.winner_team_id IS NOT NULL
  ORDER BY m.tournament_id, m.round DESC NULLS LAST
), up AS (
  UPDATE tournaments t SET champion_team_id = f.winner_team_id
  FROM finals f WHERE t.id = f.tournament_id AND t.champion_team_id IS NULL
  RETURNING 1
)
SELECT count(*) AS champions_set FROM up;
