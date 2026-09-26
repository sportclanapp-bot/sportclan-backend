-- ===========================================================================
-- APPLY-b03 · flag test content so it is hidden from real users (decision D3)
-- Needs migration 097 first. NOTHING IS DELETED: flagged rows stay in the
-- database, are hidden from public surfaces for non-test viewers, and are
-- removed at the launch wipe (SQL files/APPLY-seed-teardown.sql).
--
-- USERS (decided 27 Sep 2026, after reviewing every unflagged account):
-- the app has not launched, so the only real accounts are 'dipak' (the owner)
-- and 'reviewer' (the App Store / Play review login, reviewer@sportclan.in).
-- EVERY other user is flagged — COALESCE(username, '') so a NULL username is
-- flagged too. This is a one-off: new sign-ups default to unflagged.
-- (The earlier per-marker rules were replaced; the review found no real
-- person among them, and a NULL email had been hiding 679 phone-only test
-- accounts from the marker review.)
--
-- Flagged tester accounts keep working: sign-in never reads the flag, and a
-- flagged viewer sees all content, test content included (hideTestFor).
--
-- CONTENT is flagged when its creator is a flagged user, plus markers for
-- rows whose creator isn't:
--   M6  matches named like machine ids (RT<6+ digits>…)
--   M7  community posts saying "pre-launch wipe" / "Wipe pre-launch" / starting "QA "
--   M8  venues created by a flagged user, or named like "… probe …"
--
-- Each block runs on its own. Run 1, 2, 3 (read-only), then 4, 5, then CHECK-b03.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only).
-- Expected: users_to_flag = all_users - 2, real_accounts = 2.
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE COALESCE(username, '') NOT IN ('dipak', 'reviewer')) AS users_to_flag,
  count(*) FILTER (WHERE COALESCE(username, '') IN ('dipak', 'reviewer'))     AS real_accounts,
  count(*) FILTER (WHERE is_test_seed)                                         AS already_flagged,
  count(*)                                                                     AS all_users
FROM users;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Review (read-only): the accounts that will NOT be flagged.
-- Expected: exactly 2 rows, dipak and reviewer.
-- ---------------------------------------------------------------------------
SELECT username, name, email, created_at, is_test_seed
FROM users
WHERE COALESCE(username, '') IN ('dipak', 'reviewer')
ORDER BY username;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · COUNT (read-only): the users block 4 flags, and the content block 5 flags.
-- ---------------------------------------------------------------------------
WITH tu AS (
  SELECT id FROM users WHERE COALESCE(username, '') NOT IN ('dipak', 'reviewer')
)
SELECT
  (SELECT count(*) FROM tu)                                                                  AS test_users,
  (SELECT count(*) FROM teams       WHERE created_by IN (SELECT id FROM tu))                 AS teams,
  (SELECT count(*) FROM tournaments WHERE created_by IN (SELECT id FROM tu))                 AS tournaments,
  (SELECT count(*) FROM matches     WHERE created_by IN (SELECT id FROM tu)
                                       OR COALESCE(team_a_name, '') ~ '^RT[0-9]{6,}' OR COALESCE(team_b_name, '') ~ '^RT[0-9]{6,}') AS matches,
  (SELECT count(*) FROM community_posts WHERE author_id IN (SELECT id FROM tu)
                                       OR COALESCE(content, '') ILIKE '%pre-launch wipe%' OR COALESCE(content, '') ILIKE '%wipe pre-launch%'
                                       OR COALESCE(content, '') LIKE 'QA %')                 AS posts,
  (SELECT count(*) FROM chats       WHERE created_by IN (SELECT id FROM tu))                 AS chats,
  (SELECT count(*) FROM venues      WHERE created_by IN (SELECT id FROM tu) OR COALESCE(name, '') ILIKE '%probe%') AS venues;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Flag the users. Returns the number newly flagged
-- (= block 1 users_to_flag minus the already-flagged among them).
-- ---------------------------------------------------------------------------
WITH up AS (
  UPDATE users SET is_test_seed = true
  WHERE NOT is_test_seed AND COALESCE(username, '') NOT IN ('dipak', 'reviewer')
  RETURNING 1
)
SELECT count(*) AS users_flagged FROM up;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · Flag their content (and the orphan markers). One row of counts.
-- Run after block 4. Re-running is harmless.
-- ---------------------------------------------------------------------------
WITH t AS (
  UPDATE teams SET is_test_seed = true
  WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed) RETURNING 1
), tn AS (
  UPDATE tournaments SET is_test_seed = true
  WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed) RETURNING 1
), m AS (
  UPDATE matches SET is_test_seed = true
  WHERE NOT is_test_seed
    AND (created_by IN (SELECT id FROM users WHERE is_test_seed)
         OR tournament_id IN (SELECT id FROM tournaments WHERE is_test_seed OR created_by IN (SELECT id FROM users WHERE is_test_seed))
         OR COALESCE(team_a_name, '') ~ '^RT[0-9]{6,}' OR COALESCE(team_b_name, '') ~ '^RT[0-9]{6,}')
  RETURNING 1
), p AS (
  UPDATE community_posts SET is_test_seed = true
  WHERE NOT is_test_seed
    AND (author_id IN (SELECT id FROM users WHERE is_test_seed)
         OR COALESCE(content, '') ILIKE '%pre-launch wipe%' OR COALESCE(content, '') ILIKE '%wipe pre-launch%' OR COALESCE(content, '') LIKE 'QA %')
  RETURNING 1
), c AS (
  UPDATE chats SET is_test_seed = true
  WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed) RETURNING 1
), v AS (
  UPDATE venues SET is_test_seed = true
  WHERE NOT is_test_seed AND (created_by IN (SELECT id FROM users WHERE is_test_seed) OR COALESCE(name, '') ILIKE '%probe%') RETURNING 1
)
SELECT (SELECT count(*) FROM t) AS teams, (SELECT count(*) FROM tn) AS tournaments,
       (SELECT count(*) FROM m) AS matches, (SELECT count(*) FROM p) AS posts, (SELECT count(*) FROM c) AS chats,
       (SELECT count(*) FROM v) AS venues;
