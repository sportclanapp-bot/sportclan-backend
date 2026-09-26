-- ===========================================================================
-- APPLY-b03 · flag test content so it is hidden from real users (decision D3)
-- Needs migration 097 first. NOTHING IS DELETED: flagged rows stay in the
-- database, are hidden from public surfaces for non-test viewers, and are
-- removed at the launch wipe (SQL files/APPLY-seed-teardown.sql).
--
-- USERS are flagged by these markers (block 1 counts each, block 2 lists them):
--   M1  email on a test domain: …@seed.sportclan.test, …@qa.sportclan.test,
--       …@sportclan.test, or any …sportclan.test
--   M2  username seed_…, eb_test_…, qa_…, qadev…
--   M3  phone +91999000…
--   M4  name "Seed test account…"
--   M5  name contains "<script"
--   M9  email on qa.test or test.com, username qand_…   (added 27 Sep 2026)
--   M10 every deleted account — deleted_at, purged_at, a `deleted_…` username or
--       a `deleted:` phone (a scrubbed row can lack deleted_at from an older
--       path) (decided 27 Sep 2026: before launch, every deleted account is a
--       test account)
-- Every nullable column is COALESCEd: `email ILIKE …` on a NULL email is NULL,
-- which hid phone-only accounts from a NOT(…) review (found 27 Sep 2026).
-- NEVER flagged, whatever matches: usernames 'dipak' (the owner) and
-- 'reviewer' (the App Store / Play review login, reviewer@sportclan.in).-- Real accounts are excluded by construction: none of your accounts uses a
-- sportclan.test email or these usernames. CHECK block 2 lists what WOULD be
-- flagged among non-test-domain emails so you can confirm before block 4.
--
-- CONTENT is flagged when its creator is a flagged user, plus two name/content
-- markers for rows whose creator is gone:
--   M6  matches named like machine ids (RT<6+ digits>…) or SC<digits>/Z<digit> test fixtures
--   M7  community posts saying "pre-launch wipe" / "Wipe pre-launch" / starting "QA "
--   M8  venues created by a flagged user, or named like "… probe …"
--
-- The four QA device accounts (qadev_*) ARE flagged: test viewers still see all
-- test content, so they keep working and see each other.
--
-- Each block runs on its own. Run 1, 2, 3 (read-only), then 4, 5, then CHECK-b03.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only): users per marker, and the union.
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE COALESCE(email, '') ILIKE '%sportclan.test' OR COALESCE(email, '') ILIKE '%qa.test' OR COALESCE(email, '') ILIKE '%@test.com') AS m1_m9_test_email,
  count(*) FILTER (WHERE COALESCE(username, '') LIKE 'seed\_%' OR COALESCE(username, '') LIKE 'eb\_test\_%' OR COALESCE(username, '') LIKE 'qa\_%'
                      OR COALESCE(username, '') LIKE 'qadev%' OR COALESCE(username, '') LIKE 'qand\_%')  AS m2_m9_username,
  count(*) FILTER (WHERE COALESCE(phone, '') LIKE '+91999000%')                                            AS m3_phone,
  count(*) FILTER (WHERE COALESCE(name, '') ILIKE 'Seed test account%')                                    AS m4_seed_name,
  count(*) FILTER (WHERE COALESCE(name, '') ILIKE '%<script%')                                             AS m5_script_name,
  count(*) FILTER (WHERE deleted_at IS NOT NULL OR purged_at IS NOT NULL
                      OR COALESCE(username, '') LIKE 'deleted\_%' OR COALESCE(phone, '') LIKE 'deleted:%') AS m10_deleted,
  count(*) FILTER (WHERE COALESCE(username, '') NOT IN ('dipak', 'reviewer') AND (COALESCE(email, '') ILIKE '%sportclan.test' OR COALESCE(email, '') ILIKE '%qa.test' OR COALESCE(email, '') ILIKE '%@test.com'
       OR COALESCE(username, '') LIKE 'seed\_%' OR COALESCE(username, '') LIKE 'eb\_test\_%' OR COALESCE(username, '') LIKE 'qa\_%'
       OR COALESCE(username, '') LIKE 'qadev%' OR COALESCE(username, '') LIKE 'qand\_%'
       OR COALESCE(phone, '') LIKE '+91999000%' OR COALESCE(name, '') ILIKE 'Seed test account%' OR COALESCE(name, '') ILIKE '%<script%'
       OR deleted_at IS NOT NULL OR purged_at IS NOT NULL
       OR COALESCE(username, '') LIKE 'deleted\_%' OR COALESCE(phone, '') LIKE 'deleted:%'))                                                  AS users_to_flag,
  count(*) FILTER (WHERE is_test_seed)                                                       AS already_flagged,
  count(*)                                                                                   AS all_users
FROM users;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Review (read-only): flagged LIVE users whose email is NOT a
-- sportclan.test address — the ones most likely to be a mistake.
-- ---------------------------------------------------------------------------
SELECT username, name, email, phone, created_at
FROM users
WHERE COALESCE(username, '') NOT IN ('dipak', 'reviewer') AND deleted_at IS NULL
  AND NOT (COALESCE(email, '') ILIKE '%sportclan.test')
  AND (COALESCE(email, '') ILIKE '%sportclan.test' OR COALESCE(email, '') ILIKE '%qa.test' OR COALESCE(email, '') ILIKE '%@test.com'
       OR COALESCE(username, '') LIKE 'seed\_%' OR COALESCE(username, '') LIKE 'eb\_test\_%' OR COALESCE(username, '') LIKE 'qa\_%'
       OR COALESCE(username, '') LIKE 'qadev%' OR COALESCE(username, '') LIKE 'qand\_%'
       OR COALESCE(phone, '') LIKE '+91999000%' OR COALESCE(name, '') ILIKE 'Seed test account%' OR COALESCE(name, '') ILIKE '%<script%'
       OR deleted_at IS NOT NULL OR purged_at IS NOT NULL
       OR COALESCE(username, '') LIKE 'deleted\_%' OR COALESCE(phone, '') LIKE 'deleted:%')
ORDER BY created_at
LIMIT 200;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · COUNT (read-only): the users block 4 flags, and the content block 5 flags.
-- ---------------------------------------------------------------------------
WITH tu AS (
  SELECT id FROM users
  WHERE COALESCE(username, '') NOT IN ('dipak', 'reviewer') AND (is_test_seed OR (COALESCE(email, '') ILIKE '%sportclan.test' OR COALESCE(email, '') ILIKE '%qa.test' OR COALESCE(email, '') ILIKE '%@test.com'
       OR COALESCE(username, '') LIKE 'seed\_%' OR COALESCE(username, '') LIKE 'eb\_test\_%' OR COALESCE(username, '') LIKE 'qa\_%'
       OR COALESCE(username, '') LIKE 'qadev%' OR COALESCE(username, '') LIKE 'qand\_%'
       OR COALESCE(phone, '') LIKE '+91999000%' OR COALESCE(name, '') ILIKE 'Seed test account%' OR COALESCE(name, '') ILIKE '%<script%'
       OR deleted_at IS NOT NULL OR purged_at IS NOT NULL
       OR COALESCE(username, '') LIKE 'deleted\_%' OR COALESCE(phone, '') LIKE 'deleted:%'))
)
SELECT
  (SELECT count(*) FROM tu)                                                                  AS test_users,
  (SELECT count(*) FROM teams       WHERE created_by IN (SELECT id FROM tu))                 AS teams,
  (SELECT count(*) FROM tournaments WHERE created_by IN (SELECT id FROM tu))                 AS tournaments,
  (SELECT count(*) FROM matches     WHERE created_by IN (SELECT id FROM tu)
                                       OR COALESCE(team_a_name, '') ~ '^RT[0-9]{6,}' OR COALESCE(team_b_name, '') ~ '^RT[0-9]{6,}') AS matches,
  (SELECT count(*) FROM community_posts WHERE author_id IN (SELECT id FROM tu)
                                       OR COALESCE(content, '') ILIKE '%pre-launch wipe%' OR COALESCE(content, '') ILIKE '%wipe pre-launch%'
                                       OR COALESCE(content, '') LIKE 'QA %')                               AS posts,
  (SELECT count(*) FROM chats       WHERE created_by IN (SELECT id FROM tu))                 AS chats,
  (SELECT count(*) FROM venues      WHERE created_by IN (SELECT id FROM tu) OR COALESCE(name, '') ILIKE '%probe%') AS venues;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · Flag the users. Returns the number newly flagged
-- (≈ block 3 test_users minus block 1 already_flagged).
-- ---------------------------------------------------------------------------
WITH up AS (
  UPDATE users SET is_test_seed = true
  WHERE NOT is_test_seed AND COALESCE(username, '') NOT IN ('dipak', 'reviewer') AND (COALESCE(email, '') ILIKE '%sportclan.test' OR COALESCE(email, '') ILIKE '%qa.test' OR COALESCE(email, '') ILIKE '%@test.com'
       OR COALESCE(username, '') LIKE 'seed\_%' OR COALESCE(username, '') LIKE 'eb\_test\_%' OR COALESCE(username, '') LIKE 'qa\_%'
       OR COALESCE(username, '') LIKE 'qadev%' OR COALESCE(username, '') LIKE 'qand\_%'
       OR COALESCE(phone, '') LIKE '+91999000%' OR COALESCE(name, '') ILIKE 'Seed test account%' OR COALESCE(name, '') ILIKE '%<script%'
       OR deleted_at IS NOT NULL OR purged_at IS NOT NULL
       OR COALESCE(username, '') LIKE 'deleted\_%' OR COALESCE(phone, '') LIKE 'deleted:%')
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
