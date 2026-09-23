-- ===========================================================================
-- B2-a · purgeExpiredAccountsCore — DRY RUN ONLY. Nothing here writes.
--
-- Context. The function is imported into src/index.ts and NEVER CALLED, so the
-- Delete account screen's promise that "remaining records are erased after 30
-- days" is not being kept. Before it is wired up it has to be understood,
-- because unlike the match sweepers this one DELETES ROWS.
--
-- What the function actually does (src/controllers/account.controller.ts:145):
--   1. SELECT id FROM users WHERE deleted_at < now() - 30 days
--                             AND deleted_at IS NOT NULL
--   2. DELETE FROM users WHERE id IN (those ids)
--
-- That is the whole of it. It touches exactly ONE table by name: `users`.
-- Everything else is delegated to the database, on the strength of a comment
-- that reads "FK cascades on user_id SHOULD clear content automatically".
-- "Should" is the problem, and block 2 is what turns it into a fact.
--
-- Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · How many accounts would this delete, and how old are they?
-- Expected before launch: a small number, or zero.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                              AS would_purge,
  min(deleted_at)                                       AS oldest_deletion,
  max(deleted_at)                                       AS newest_eligible_deletion,
  count(*) FILTER (WHERE deleted_at > now() - interval '30 days') AS not_yet_eligible
FROM users
WHERE deleted_at IS NOT NULL
  AND deleted_at < now() - interval '30 days';


-- ---------------------------------------------------------------------------
-- BLOCK 2 · THE IMPORTANT ONE. Every foreign key that points at users, and what
-- the database will do to it on delete.
--
--   'c' CASCADE   → the child rows are deleted too. Intended.
--   'n' SET NULL  → the row survives, detached. Intended for authored content.
--   'a' NO ACTION
--   'r' RESTRICT  → the DELETE FAILS. Any row here means the purge throws and
--                   the whole function errors out for every account at once.
--   'd' SET DEFAULT
--
-- Read this list before wiring anything up. A RESTRICT makes the job a no-op
-- that raises; a missing FK means orphans nobody will ever find.
-- ---------------------------------------------------------------------------
SELECT
  con.confrelid::regclass          AS references_table,
  con.conrelid::regclass           AS child_table,
  a.attname                        AS child_column,
  CASE con.confdeltype
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'd' THEN 'SET DEFAULT'
  END                              AS on_delete
FROM pg_constraint con
JOIN pg_attribute a
  ON a.attrelid = con.conrelid
 AND a.attnum   = ANY (con.conkey)
WHERE con.contype = 'f'
  AND con.confrelid = 'users'::regclass
ORDER BY on_delete, child_table;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Anything that would BLOCK the delete outright.
-- Expected: zero rows. A non-empty result means the purge cannot run as written.
-- ---------------------------------------------------------------------------
SELECT
  con.conrelid::regclass AS child_table,
  con.conname            AS constraint_name,
  CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END AS on_delete
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.confrelid = 'users'::regclass
  AND con.confdeltype IN ('a', 'r');


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Tables holding a user id with NO foreign key to users at all.
-- These would be left as orphans — the purge cannot cascade what it is not
-- connected to. Expected: review each hit by hand.
-- ---------------------------------------------------------------------------
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname IN ('user_id', 'created_by', 'sender_id', 'recipient_id', 'author_id')
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.conrelid = c.oid
      AND a.attnum = ANY (con.conkey)
      AND con.confrelid = 'users'::regclass
  )
ORDER BY table_name, column_name;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · Per-table row counts for the accounts that would be purged.
-- Run AFTER block 2 has shown which tables matter; this is the "how much would
-- actually disappear" number. Adjust the table list to match block 2's output.
-- ---------------------------------------------------------------------------
WITH doomed AS (
  SELECT id FROM users
  WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
)
SELECT 'match_participants' AS table_name, count(*) AS rows_affected
  FROM match_participants WHERE user_id IN (SELECT id FROM doomed)
UNION ALL SELECT 'community_posts', count(*)
  FROM community_posts WHERE user_id IN (SELECT id FROM doomed)
UNION ALL SELECT 'team_members', count(*)
  FROM team_members WHERE user_id IN (SELECT id FROM doomed)
UNION ALL SELECT 'coin_events', count(*)
  FROM coin_events WHERE user_id IN (SELECT id FROM doomed)
UNION ALL SELECT 'notifications', count(*)
  FROM notifications WHERE user_id IN (SELECT id FROM doomed)
ORDER BY table_name;
