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
-- BLOCK 2 · Users left UNflagged. Expected: exactly 2 rows, dipak and reviewer.
-- ---------------------------------------------------------------------------
SELECT username, name, email, created_at
FROM users WHERE NOT is_test_seed
ORDER BY created_at LIMIT 200;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · The tester accounts are flagged and the two real accounts are not.
-- Expected: 9 rows — the 7 testers true, dipak false, reviewer false.
-- ---------------------------------------------------------------------------
SELECT username, is_test_seed FROM users
WHERE username IN ('qadev_a_qa', 'qadev_b_qa', 'qadev_c_qa', 'qadev_d_qa', 'qaflow922_qa', 'sc434fresh_qa',
                   'scadmin970_qa', 'dipak', 'reviewer')
ORDER BY is_test_seed DESC, username;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Content left UNflagged per table — what real users will still see.
-- Expected: 0 in every column (every row had a creator; decided 27 Sep 2026
-- that all of it, dipak's and reviewer's included, is test content).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM teams           WHERE NOT is_test_seed) AS teams,
  (SELECT count(*) FROM tournaments     WHERE NOT is_test_seed) AS tournaments,
  (SELECT count(*) FROM matches         WHERE NOT is_test_seed) AS matches,
  (SELECT count(*) FROM community_posts WHERE NOT is_test_seed) AS posts,
  (SELECT count(*) FROM chats           WHERE NOT is_test_seed) AS chats,
  (SELECT count(*) FROM venues          WHERE NOT is_test_seed) AS venues;
