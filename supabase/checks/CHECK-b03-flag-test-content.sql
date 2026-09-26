-- ===========================================================================
-- CHECK-b03 · after APPLY-b03. Read-only. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · Totals flagged per table.
-- ---------------------------------------------------------------------------
SELECT 'users' AS t, count(*) FILTER (WHERE is_test_seed) AS flagged, count(*) AS total FROM users
UNION ALL SELECT 'teams', count(*) FILTER (WHERE is_test_seed), count(*) FROM teams
UNION ALL SELECT 'matches', count(*) FILTER (WHERE is_test_seed), count(*) FROM matches
UNION ALL SELECT 'tournaments', count(*) FILTER (WHERE is_test_seed), count(*) FROM tournaments
UNION ALL SELECT 'community_posts', count(*) FILTER (WHERE is_test_seed), count(*) FROM community_posts
UNION ALL SELECT 'chats', count(*) FILTER (WHERE is_test_seed), count(*) FROM chats
UNION ALL SELECT 'venues', count(*) FILTER (WHERE is_test_seed), count(*) FROM venues;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Real people left UNflagged (what a normal user will still see).
-- Review: expected to be your real accounts and genuine users only.
-- ---------------------------------------------------------------------------
SELECT username, name, email, created_at
FROM users WHERE NOT is_test_seed AND deleted_at IS NULL
ORDER BY created_at LIMIT 200;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · The four device accounts are flagged, and the two real accounts
-- are not. Expected: 6 rows — qadev_* true, dipak false, reviewer false.
-- ---------------------------------------------------------------------------
SELECT username, is_test_seed FROM users
WHERE username IN ('qadev_a_qa', 'qadev_b_qa', 'qadev_c_qa', 'qadev_d_qa', 'dipak', 'reviewer') ORDER BY username;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Test-looking content still UNflagged (the review's examples).
-- Expected: 0 rows, or rows you recognise as real.
-- ---------------------------------------------------------------------------
SELECT 'match' AS kind, team_a_name || ' vs ' || team_b_name AS label FROM matches
 WHERE NOT is_test_seed AND (team_a_name ~ '^(RT[0-9]|SC[0-9]|Z[0-9]|TBD)' OR team_b_name ~ '^(RT[0-9]|SC[0-9]|Z[0-9])')
UNION ALL SELECT 'team', name FROM teams WHERE NOT is_test_seed AND name ~* '^(SC[0-9]|QA |SEEDTEAM|Smoke)'
UNION ALL SELECT 'post', left(content, 80) FROM community_posts WHERE NOT is_test_seed AND content ~* '(QA|seed|wipe|test post)'
LIMIT 100;
