-- ===========================================================================
-- CHECK 092 · did the purge scrub work, and did it delete anything?
--
-- Read-only. Nothing here writes. Run block 1 BEFORE the deploy, blocks 2-5
-- after the first hourly sweep has had a chance to run.
--
-- The one thing this check exists to prove: the row count does not move.
-- Every other property of the job is secondary to "it deletes nothing".
--
-- Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · BASELINE. Run this BEFORE applying migration 092 and keep the
-- numbers.
--
-- No purged_at column here, deliberately: 092 is what adds it, so naming it in
-- the pre-migration baseline makes this block fail with "column purged_at does
-- not exist" — on the one run whose whole job is to record the before picture.
-- Its value at this point is known anyway: nothing has been purged, because
-- nothing could have been.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                        AS users_total,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)  AS soft_deleted,
  0                                               AS purged,
  (SELECT count(*) FROM community_posts)          AS posts_total,
  (SELECT count(*) FROM post_comments)            AS comments_total,
  (SELECT count(*) FROM user_reviews)             AS reviews_total,
  (SELECT count(*) FROM teams)                    AS teams_total,
  (SELECT count(*) FROM matches)                  AS matches_total
FROM users;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · AFTER. users_total must EQUAL the baseline. So must every other
-- count. `purged` is the only number allowed to move, and only upwards.
--
-- If users_total has dropped, the job is deleting rows and must be stopped.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                        AS users_total,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)  AS soft_deleted,
  count(*) FILTER (WHERE purged_at  IS NOT NULL)  AS purged,
  (SELECT count(*) FROM community_posts)          AS posts_total,
  (SELECT count(*) FROM post_comments)            AS comments_total,
  (SELECT count(*) FROM user_reviews)             AS reviews_total,
  (SELECT count(*) FROM teams)                    AS teams_total,
  (SELECT count(*) FROM matches)                  AS matches_total
FROM users;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · What is left on a purged row.
--
-- Every column here must be null / a sentinel / a zero. `phone` is the one
-- exception: it is NOT NULL in the schema, so it carries the same
-- 'deleted:<id>' sentinel that re-registration already writes (auth.controller)
-- rather than a second shape nobody would recognise.
--
-- Expected: 0 rows. Any row returned is a purged account still holding
-- something personal.
-- ---------------------------------------------------------------------------
SELECT id, purged_at,
       phone, email, referral_code, city_id, state, google_id,
       coin_balance, password_hash, referred_by
FROM users
WHERE purged_at IS NOT NULL
  AND (
       phone NOT LIKE 'deleted:%'
    OR email          IS NOT NULL
    OR referral_code  IS NOT NULL
    OR city_id        IS NOT NULL
    OR state          IS NOT NULL
    OR google_id      IS NOT NULL
    OR password_hash  IS NOT NULL
    OR referred_by    IS NOT NULL
    OR coin_balance  <> 0
  );


-- ---------------------------------------------------------------------------
-- BLOCK 4 · IDEMPOTENCE. A row is purged once and never revisited.
--
-- Expected: 0 rows. A purged_at that keeps moving means the job is re-scrubbing
-- rows it has already finished — harmless to the data, but it means the
-- `purged_at IS NULL` guard is not being applied, and the "eligible" set grows
-- without bound.
-- ---------------------------------------------------------------------------
SELECT id, deleted_at, purged_at,
       purged_at - deleted_at AS held_for
FROM users
WHERE purged_at IS NOT NULL
  AND purged_at > now() - interval '2 hours'
  AND deleted_at < now() - interval '32 days'
ORDER BY purged_at DESC;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · The promise the tombstone exists to keep.
--
-- Content authored by a purged account must STILL RESOLVE to a users row —
-- that is the whole reason the row is kept. Expected: 0 orphans on every line.
-- A non-zero count means something deleted a user row after all.
-- ---------------------------------------------------------------------------
SELECT 'community_posts' AS table_name, count(*) AS orphaned_rows
  FROM community_posts p
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id)
UNION ALL
SELECT 'post_comments', count(*)
  FROM post_comments c
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.author_id)
UNION ALL
SELECT 'user_reviews', count(*)
  FROM user_reviews r
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.reviewer_id)
UNION ALL
SELECT 'teams', count(*)
  FROM teams t
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.created_by)
UNION ALL
SELECT 'matches', count(*)
  FROM matches m
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.created_by);
