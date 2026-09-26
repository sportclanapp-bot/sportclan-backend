-- NOT RUN (decided 27 Sep 2026): test data only — every production row is
-- dummy/test data and the launch wipe removes it. Kept for reference; the code
-- now keeps real data correct as it is created and changed.

-- ===========================================================================
-- CHECK-b06 · after APPLY-b06. Read-only. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · Bracket tournaments still without a champion that HAVE a decided
-- final. Expected: 0.
-- ---------------------------------------------------------------------------
SELECT count(*) AS still_missing
FROM tournaments t
WHERE t.status = 'completed' AND t.champion_team_id IS NULL
  AND COALESCE(t.format, 'knockout') NOT IN ('league', 'round_robin')
  AND EXISTS (
    SELECT 1 FROM matches m
    WHERE m.tournament_id = t.id AND m.next_match_id IS NULL AND m.group_label IS NULL
      AND m.status = 'completed' AND m.voided_at IS NULL AND m.winner_team_id IS NOT NULL
  );


-- ---------------------------------------------------------------------------
-- BLOCK 2 · The review's example. Expected: S5 KO Cup → Smoke Tigers.
-- ---------------------------------------------------------------------------
SELECT t.name, t.status, tm.name AS champion
FROM tournaments t LEFT JOIN teams tm ON tm.id = t.champion_team_id
WHERE t.name ILIKE 'S5 KO Cup%';
