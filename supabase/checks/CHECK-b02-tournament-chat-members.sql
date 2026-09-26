-- NOT RUN (decided 27 Sep 2026): test data only — every production row is
-- dummy/test data and the launch wipe removes it. Kept for reference; the code
-- now keeps real data correct as it is created and changed.

-- ===========================================================================
-- CHECK-b02 · after APPLY-b02. READ-ONLY. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · every tournament chat's CURRENT members equal its
-- audience. Expected: missing = 0, not_admin = 0, outsiders = 0.
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments
  WHERE sport_metadata ? '_chat_id'
    AND EXISTS (SELECT 1 FROM chats c WHERE c.id = (sport_metadata->>'_chat_id')::uuid AND c.deleted_at IS NULL)
), organisers AS (
  SELECT tc.chat_id, tc.created_by AS user_id FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
), audience AS (
  SELECT chat_id, user_id, 'admin' AS role FROM organisers
  UNION SELECT tc.chat_id, m.user_id, 'member'
        FROM tc JOIN tournament_entries e ON e.tournament_id = tc.tournament_id AND e.status = 'approved'
                JOIN team_members m ON m.team_id = e.team_id
), one_role AS (
  -- An organiser who also plays is an admin ('admin' < 'member').
  SELECT chat_id, user_id, min(role) AS role FROM audience GROUP BY chat_id, user_id
)
SELECT
  (SELECT count(*) FROM one_role a WHERE NOT EXISTS
     (SELECT 1 FROM chat_participants p WHERE p.chat_id = a.chat_id AND p.user_id = a.user_id AND p.left_at IS NULL)) AS missing,
  (SELECT count(*) FROM organisers o JOIN chat_participants p USING (chat_id, user_id)
     WHERE p.left_at IS NULL AND p.role <> 'admin') AS not_admin,
  (SELECT count(*) FROM chat_participants p JOIN tc USING (chat_id)
     WHERE p.left_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM one_role a WHERE a.chat_id = p.chat_id AND a.user_id = p.user_id)) AS outsiders;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · READ-ONLY · spot check: the chat from the review. Expected: the
-- organiser (admin) plus the players of its approved teams, all current;
-- anyone marked left shows left = true.
-- ---------------------------------------------------------------------------
SELECT t.name, u.username, p.role, p.left_at IS NOT NULL AS "left"
FROM tournaments t
JOIN chat_participants p ON p.chat_id = (t.sport_metadata->>'_chat_id')::uuid
JOIN users u ON u.id = p.user_id
WHERE t.name ILIKE 'S5 Group Cup%'
ORDER BY p.left_at IS NOT NULL, p.role, u.username;
