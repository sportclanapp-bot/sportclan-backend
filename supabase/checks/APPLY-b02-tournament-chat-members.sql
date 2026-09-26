-- ===========================================================================
-- APPLY-b02 · bring every tournament chat in line with decision D7
-- Visual review V022 (chat had only the organiser) and N2 (anyone who opened a
-- chat became a member). Soft membership (decided 27 Sep 2026, migration 098):
-- nobody is deleted — a row that should not be current gets left_at, and a
-- returning member's left_at is cleared.
--
-- The audience of a tournament's chat (sport_metadata->>'_chat_id') is:
--   organisers = tournaments.created_by ∪ tournament_organisers   → role 'admin'
--   players    = team_members of teams with an APPROVED entry     → role 'member'
-- "Current" = chat_participants.left_at IS NULL. Deleted chats are skipped.
-- The backend keeps this in sync on every change (utils/tournamentChat.ts).
--
-- Needs migration 098. Each block runs on its own. Run 1 and 2 (READ-ONLY),
-- then 3, 4, 5 (CHANGES DATA), then CHECK-b02.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · chats, and audience members who are not current
-- (no row at all, or a row marked left).
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
  (SELECT count(*) FROM tc) AS tournament_chats,
  (SELECT count(*) FROM one_role a WHERE NOT EXISTS
     (SELECT 1 FROM chat_participants p WHERE p.chat_id = a.chat_id AND p.user_id = a.user_id)) AS new_rows_to_add,
  (SELECT count(*) FROM one_role a WHERE EXISTS
     (SELECT 1 FROM chat_participants p WHERE p.chat_id = a.chat_id AND p.user_id = a.user_id AND p.left_at IS NOT NULL)) AS left_rows_to_rejoin;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · READ-ONLY · current organisers who aren't admins, and current
-- members who aren't in the audience (block 5 marks them as left).
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
  (SELECT count(*) FROM chat_participants p JOIN organisers o USING (chat_id, user_id)
     WHERE p.left_at IS NULL AND p.role <> 'admin') AS organisers_to_promote,
  (SELECT count(*) FROM chat_participants p JOIN tc USING (chat_id)
     WHERE p.left_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM one_role a WHERE a.chat_id = p.chat_id AND a.user_id = p.user_id)) AS outsiders_to_mark_left;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · CHANGES DATA · add the missing members and rejoin the ones marked
-- left. Returns added + rejoined (= block 1's two counts).
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
), ins AS (
  INSERT INTO chat_participants (chat_id, user_id, role)
  SELECT chat_id, user_id, role FROM one_role
  ON CONFLICT (chat_id, user_id) DO NOTHING
  RETURNING 1
), rejoin AS (
  UPDATE chat_participants p SET left_at = NULL, role = a.role, joined_at = now()
  FROM one_role a
  WHERE p.chat_id = a.chat_id AND p.user_id = a.user_id AND p.left_at IS NOT NULL
  RETURNING 1
)
SELECT (SELECT count(*) FROM ins) AS added, (SELECT count(*) FROM rejoin) AS rejoined;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · CHANGES DATA · promote current organisers who are plain members.
-- Returns the number (= block 2's organisers_to_promote).
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
), up AS (
  UPDATE chat_participants p SET role = 'admin'
  FROM organisers o
  WHERE p.chat_id = o.chat_id AND p.user_id = o.user_id AND p.left_at IS NULL AND p.role <> 'admin'
  RETURNING 1
)
SELECT count(*) AS promoted FROM up;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · CHANGES DATA · soft leave for outsiders — people who only got in
-- by opening the chat (N2). Their rows stay, with left_at set; nobody is
-- deleted. Returns the number (= block 2's outsiders_to_mark_left).
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
), gone AS (
  UPDATE chat_participants p SET left_at = now(), typing_until = NULL
  FROM tc
  WHERE p.chat_id = tc.chat_id AND p.left_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM one_role a WHERE a.chat_id = p.chat_id AND a.user_id = p.user_id)
  RETURNING 1
)
SELECT count(*) AS marked_left FROM gone;
