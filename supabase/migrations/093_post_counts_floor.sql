-- ===========================================================================
-- 093 · the two oldest count caches can go negative. The newest one cannot.
--
-- migration 005 maintains community_posts.likes_count and comments_count by
-- trigger with a bare `- 1`. migration 075 added the SAME pair of triggers for
-- profile_posts and wrote `GREATEST(likes_count - 1, 0)` — so the floor was
-- understood to be necessary by the time the second table was built, and the
-- first was never brought into line.
--
-- A negative cache is not a rounding problem. It is a post that reads "0 likes"
-- while a like exists on it, because the count climbed out of a hole first —
-- the display clamps at zero long before the number does. That is the exact
-- shape of the report this batch is fixing from the other end (the notification
-- that outlived its like), and the two are easy to confuse when only one has
-- been fixed.
--
-- Recounts from the source rows as well, so any drift already on the table is
-- corrected rather than merely stopped.
--
-- Additive and idempotent: CREATE OR REPLACE on both functions, no schema
-- change, no trigger dropped. Safe to apply BEFORE the deploy.
--
-- Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · The floor, on both counters.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_post_likes_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_post_comments_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Correct whatever has already drifted.
--
-- Touches only the rows that are actually wrong (IS DISTINCT FROM), so it is
-- cheap, it is safe to re-run, and the row count it reports is itself the
-- answer to "how bad was it?".
--
-- One grouped aggregate per table, joined once — NOT a correlated count per
-- post. Same answer, but it reads post_likes and post_comments once each
-- instead of once per post, which on 15k posts and 30k comments is the
-- difference between a query you watch and one you don't notice.
--
-- LEFT JOIN + COALESCE, because a post with no likes has no row in the
-- aggregate at all: an inner join would skip exactly the posts whose count
-- most needs to be 0.
-- ---------------------------------------------------------------------------
UPDATE community_posts p
   SET likes_count = c.n
  FROM (
    SELECT p2.id, COALESCE(l.n, 0) AS n
      FROM community_posts p2
      LEFT JOIN (SELECT post_id, count(*) AS n FROM post_likes GROUP BY post_id) l
             ON l.post_id = p2.id
  ) c
 WHERE p.id = c.id
   AND p.likes_count IS DISTINCT FROM c.n;

UPDATE community_posts p
   SET comments_count = c.n
  FROM (
    SELECT p2.id, COALESCE(k.n, 0) AS n
      FROM community_posts p2
      LEFT JOIN (SELECT post_id, count(*) AS n FROM post_comments GROUP BY post_id) k
             ON k.post_id = p2.id
  ) c
 WHERE p.id = c.id
   AND p.comments_count IS DISTINCT FROM c.n;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Proof. Expected: 0 rows AFTER block 2.
--
-- Run it BEFORE block 2 as well, if you want the drift measured rather than
-- merely corrected: every row it returns then is a post whose cached count
-- disagreed with the rows it caches, with both numbers side by side.
--
-- Same shape as block 2 so the two cannot disagree about what "correct" means.
-- ---------------------------------------------------------------------------
SELECT p.id,
       p.likes_count,
       COALESCE(l.n, 0) AS real_likes,
       p.comments_count,
       COALESCE(k.n, 0) AS real_comments
  FROM community_posts p
  LEFT JOIN (SELECT post_id, count(*) AS n FROM post_likes    GROUP BY post_id) l ON l.post_id = p.id
  LEFT JOIN (SELECT post_id, count(*) AS n FROM post_comments GROUP BY post_id) k ON k.post_id = p.id
 WHERE p.likes_count    IS DISTINCT FROM COALESCE(l.n, 0)
    OR p.comments_count IS DISTINCT FROM COALESCE(k.n, 0);
