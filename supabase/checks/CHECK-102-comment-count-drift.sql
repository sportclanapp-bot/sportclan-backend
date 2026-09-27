-- ===========================================================================
-- CHECK-102 · READ-ONLY · is the comments_count drift (543 posts) seed data
-- or a live code bug? Nothing here writes.
--
-- The only code that ever writes comments_count directly is the dev seeder
-- (dev.controller.ts, loadFullData step 11: comments_count = randInt(1, 25)
-- on 60 template posts, author = the dummy seed users, or the CALLER when
-- there are fewer than 10 of them). Every other change goes through
-- trg_post_comments_count. So a real post that drifted would point at a bug;
-- a seeded one would not.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- QUERY 1 · who the drifted posts belong to, which way they drift, and when.
-- Expected if it is seed-only: every row is seed / test-flagged, OR the
-- "dipak/reviewer" rows are all over-counted (count > actual) on seeder
-- template content (checked in query 2).
-- ---------------------------------------------------------------------------
WITH drift AS (
  SELECT p.id, p.created_at, p.comments_count, p.content, u.username, u.name, u.is_test_seed,
         (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id) AS actual
  FROM community_posts p
  JOIN users u ON u.id = p.author_id
  WHERE p.comments_count <> (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id)
)
SELECT
  CASE
    WHEN username ILIKE 'seed\_user\_%'                      THEN 'seed_user'
    WHEN username ILIKE '%dipak%' OR name ILIKE '%dipak%'    THEN 'dipak'
    WHEN username ILIKE '%review%' OR name ILIKE '%review%'  THEN 'reviewer'
    WHEN is_test_seed                                        THEN 'test-flagged'
    ELSE 'other'
  END                                                   AS author_kind,
  count(*)                                              AS posts,
  count(*) FILTER (WHERE comments_count > actual)       AS over_counted,
  count(*) FILTER (WHERE comments_count < actual)       AS under_counted,
  min(created_at)                                       AS first_created,
  max(created_at)                                       AS last_created
FROM drift
GROUP BY 1
ORDER BY 2 DESC;


-- ---------------------------------------------------------------------------
-- QUERY 2 · every drifted post NOT by a seed_user account, newest first
-- (at most 100). Expected if it is seed-only: content is seeder template text
-- (short sports chatter), actual comment rows small, and no row newer than the
-- last seeding run.
-- ---------------------------------------------------------------------------
SELECT p.id, p.created_at, u.username, u.is_test_seed,
       p.comments_count,
       (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id) AS actual,
       left(p.content, 60) AS content_start
FROM community_posts p
JOIN users u ON u.id = p.author_id
WHERE p.comments_count <> (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id)
  AND u.username NOT ILIKE 'seed\_user\_%'
ORDER BY p.created_at DESC
LIMIT 100;
