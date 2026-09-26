-- ===========================================================================
-- CHECK-098 · after migration 098. Each block runs on its own.
-- Blocks 1–2 only read. Block 3 writes inside a block that always ends by
-- raising, so everything it did is rolled back and nothing persists.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing test-made is left unflagged.
-- Expected: all zeros.
-- ---------------------------------------------------------------------------
WITH tu AS (SELECT id FROM users WHERE is_test_seed)
SELECT
  (SELECT count(*) FROM teams           WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS teams,
  (SELECT count(*) FROM tournaments     WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS tournaments,
  (SELECT count(*) FROM matches         WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS matches,
  (SELECT count(*) FROM community_posts WHERE NOT is_test_seed AND author_id  IN (SELECT id FROM tu)) AS posts,
  (SELECT count(*) FROM chats           WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS chats,
  (SELECT count(*) FROM venues          WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS venues;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · READ-ONLY · the new columns start empty (no row is revoked, left
-- or deleted by the migration itself). Expected: all zeros until someone acts.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM user_badges       WHERE revoked_at IS NOT NULL) AS revoked_badges,
  (SELECT count(*) FROM chat_participants WHERE left_at    IS NOT NULL) AS left_members,
  (SELECT count(*) FROM chats             WHERE deleted_at IS NOT NULL) AS deleted_chats;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · the trigger, rolled back. A venue created by a test account is
-- flagged; one created by dipak is not.
-- Expected: ERROR "CHECK-098 PASS · test-made venue flagged, real one not"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  qa uuid := (SELECT id FROM users WHERE username = 'qadev_a_qa');
  me uuid := (SELECT id FROM users WHERE username = 'dipak');
  f1 boolean; f2 boolean;
BEGIN
  INSERT INTO venues (name, created_by) VALUES ('CHECK-098 test venue', qa) RETURNING is_test_seed INTO f1;
  INSERT INTO venues (name, created_by) VALUES ('CHECK-098 real venue', me) RETURNING is_test_seed INTO f2;
  IF f1 AND NOT f2 THEN
    RAISE EXCEPTION 'CHECK-098 PASS · test-made venue flagged, real one not';
  END IF;
  RAISE EXCEPTION 'CHECK-098 FAIL · test=% real=%', f1, f2;
END $$;
