-- 040: atomic free-tier post-cap enforcement (SC-60 — cap bypass fix).
-- createPost previously did a check-then-act: SELECT count(*) of this-month posts,
-- compare >= 5, then INSERT in a separate statement. Concurrent creates all read
-- the same count, all passed the check, and all inserted — so a free user could
-- exceed the 5-posts/month cap.
--
-- This function serializes each user's create with pg_advisory_xact_lock over the
-- user id, so the count + insert are effectively one critical section per user.
-- Premium/unlimited users bypass the count entirely (as before). On the cap it
-- RAISEs POST_LIMIT_REACHED, which the controller maps to the existing 403 shape.
-- Returns the inserted community_posts row (RETURNS SETOF), so the controller
-- keeps its existing .select().single()-shaped response.
CREATE OR REPLACE FUNCTION create_post_capped(
  p_author_id  UUID,
  p_is_premium BOOLEAN,
  p_content    TEXT,
  p_image_url  TEXT,
  p_link_url   TEXT,
  p_sport_id   UUID,
  p_city_id    UUID,
  p_post_type  TEXT,
  p_mentions   UUID[],
  p_poll_options JSONB,
  p_scheduled_at TIMESTAMPTZ
)
RETURNS SETOF community_posts AS $$
DECLARE
  v_row community_posts;
  v_count INT;
BEGIN
  IF NOT COALESCE(p_is_premium, FALSE) THEN
    -- Per-user transaction lock: same-user concurrent creates queue here, so the
    -- count below always reflects prior committed inserts in this critical section.
    PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

    SELECT count(*) INTO v_count
    FROM community_posts
    WHERE author_id = p_author_id
      AND created_at >= date_trunc('month', now());

    IF v_count >= 5 THEN
      RAISE EXCEPTION 'POST_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO community_posts (
    author_id, content, image_url, link_url, sport_id, city_id,
    post_type, mentions, poll_options, scheduled_at
  )
  VALUES (
    p_author_id, p_content, p_image_url, p_link_url, p_sport_id, p_city_id,
    COALESCE(p_post_type, 'general'), COALESCE(p_mentions, '{}'::uuid[]),
    p_poll_options, p_scheduled_at
  )
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql;
