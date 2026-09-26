-- ===========================================================================
-- APPLY-b02 · bring every tournament chat in line with decision D7
-- Visual review V022 (chat had only the organiser) and N2 (anyone who opened a
-- chat became a member).
--
-- The audience of a tournament's chat (sport_metadata->>'_chat_id') is:
--   organisers = tournaments.created_by ∪ tournament_organisers   → role 'admin'
--   players    = team_members of teams with an APPROVED entry     → role 'member'
-- From BE-1 on, the backend keeps this in sync on every entry, roster and
-- organiser change (utils/tournamentChat.ts). This fixes the chats that exist now.
--
-- Each block runs on its own. Run 1 and 2 (counts), then 3, 4, 5, then CHECK-b02.
-- Block 5 REMOVES people; its count is block 2's "outsiders".
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only): chats and the members they are missing.
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments
  WHERE sport_metadata ? '_chat_id'
    AND EXISTS (SELECT 1 FROM chats c WHERE c.id = (sport_metadata->>'_chat_id')::uuid)
), audience AS (
  SELECT tc.chat_id, tc.created_by AS user_id, 'admin' AS role FROM tc WHERE tc.created_by IS NOT NULL
  UNION
  SELECT tc.chat_id, o.user_id, 'admin' FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
  UNION
  SELECT tc.chat_id, m.user_id, 'member'
  FROM tc JOIN tournament_entries e ON e.tournament_id = tc.tournament_id AND e.status = 'approved'
          JOIN team_members m ON m.team_id = e.team_id
)
SELECT
  (SELECT count(*) FROM tc)                                                          AS tournament_chats,
  (SELECT count(DISTINCT (chat_id, user_id)) FROM audience a
     WHERE NOT EXISTS (SELECT 1 FROM chat_participants p WHERE p.chat_id = a.chat_id AND p.user_id = a.user_id))
                                                                                     AS members_to_add;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · COUNT (read-only): organisers to promote, and outsiders to remove.
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments WHERE sport_metadata ? '_chat_id'
), audience AS (
  SELECT tc.chat_id, tc.created_by AS user_id FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
  UNION SELECT tc.chat_id, m.user_id
        FROM tc JOIN tournament_entries e ON e.tournament_id = tc.tournament_id AND e.status = 'approved'
                JOIN team_members m ON m.team_id = e.team_id
), organisers AS (
  SELECT tc.chat_id, tc.created_by AS user_id FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
)
SELECT
  (SELECT count(*) FROM chat_participants p JOIN organisers o USING (chat_id, user_id) WHERE p.role <> 'admin') AS organisers_to_promote,
  (SELECT count(*) FROM chat_participants p JOIN tc USING (chat_id)
     WHERE NOT EXISTS (SELECT 1 FROM audience a WHERE a.chat_id = p.chat_id AND a.user_id = p.user_id))         AS outsiders_to_remove;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Add the missing members. Returns the number added (= block 1).
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments
  WHERE sport_metadata ? '_chat_id'
    AND EXISTS (SELECT 1 FROM chats c WHERE c.id = (sport_metadata->>'_chat_id')::uuid)
), audience AS (
  SELECT tc.chat_id, tc.created_by AS user_id, 'admin' AS role FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id, 'admin' FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
  UNION SELECT tc.chat_id, m.user_id, 'member'
        FROM tc JOIN tournament_entries e ON e.tournament_id = tc.tournament_id AND e.status = 'approved'
                JOIN team_members m ON m.team_id = e.team_id
), one_role AS (
  -- An organiser who also plays gets 'admin'.
  SELECT chat_id, user_id, min(role) AS role FROM audience GROUP BY chat_id, user_id
), ins AS (
  INSERT INTO chat_participants (chat_id, user_id, role)
  SELECT chat_id, user_id, role FROM one_role
  ON CONFLICT (chat_id, user_id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS added FROM ins;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Promote organisers who are plain members. Returns the number.
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments WHERE sport_metadata ? '_chat_id'
), organisers AS (
  SELECT tc.chat_id, tc.created_by AS user_id FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
), up AS (
  UPDATE chat_participants p SET role = 'admin'
  FROM organisers o
  WHERE p.chat_id = o.chat_id AND p.user_id = o.user_id AND p.role <> 'admin'
  RETURNING 1
)
SELECT count(*) AS promoted FROM up;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · Remove outsiders (people who only got in by opening the chat).
-- Returns the number removed (= block 2's outsiders_to_remove).
-- ---------------------------------------------------------------------------
WITH tc AS (
  SELECT id AS tournament_id, created_by, (sport_metadata->>'_chat_id')::uuid AS chat_id
  FROM tournaments WHERE sport_metadata ? '_chat_id'
), audience AS (
  SELECT tc.chat_id, tc.created_by AS user_id FROM tc WHERE tc.created_by IS NOT NULL
  UNION SELECT tc.chat_id, o.user_id FROM tc JOIN tournament_organisers o ON o.tournament_id = tc.tournament_id
  UNION SELECT tc.chat_id, m.user_id
        FROM tc JOIN tournament_entries e ON e.tournament_id = tc.tournament_id AND e.status = 'approved'
                JOIN team_members m ON m.team_id = e.team_id
), del AS (
  DELETE FROM chat_participants p
  USING tc
  WHERE p.chat_id = tc.chat_id
    AND NOT EXISTS (SELECT 1 FROM audience a WHERE a.chat_id = p.chat_id AND a.user_id = p.user_id)
  RETURNING 1
)
SELECT count(*) AS removed FROM del;
