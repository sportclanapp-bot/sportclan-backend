-- SC-434 · no tiers, so no post cap.
--
-- Free accounts were capped at 5 posts per IST month, shared across community
-- and profile posts, enforced inside these two functions (migrations 040 → 047 →
-- 075). Premium bought their way past it. There is no Premium any more, so the
-- cap is gone for everybody.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--
--   * it does not drop `p_is_premium`. Changing a function's SIGNATURE breaks
--     every caller the instant it is applied, which would mean the migration and
--     the deploy had to land in one indivisible step. The parameter stays,
--     ignored, and the controllers already pass `true` — so applying this before
--     OR after the push is safe, and nobody is capped in the window either way.
--
--   * it does not touch the advisory lock, the idempotency dedup or the inserts.
--     Those are the parts that stop a double-tap becoming two posts, and they are
--     byte-identical to 075 below. Only the cap block is removed.
--
--   * it deletes no rows and no columns. Posts written under the cap stay exactly
--     as they are.

CREATE OR REPLACE FUNCTION create_post_capped(
  p_author_id        UUID,
  p_is_premium       BOOLEAN,
  p_content          TEXT,
  p_image_url        TEXT,
  p_link_url         TEXT,
  p_sport_id         UUID,
  p_city_id          UUID,
  p_post_type        TEXT,
  p_mentions         UUID[],
  p_poll_options     JSONB,
  p_scheduled_at     TIMESTAMPTZ,
  p_client_key       UUID DEFAULT NULL,
  p_backstop_seconds NUMERIC DEFAULT 2,
  p_match_id         UUID DEFAULT NULL
)
RETURNS SETOF community_posts AS $$
DECLARE
  v_row community_posts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM community_posts
      WHERE author_id = p_author_id AND client_key = p_client_key LIMIT 1;
    IF FOUND THEN RETURN NEXT v_row; RETURN; END IF;
  ELSE
    SELECT * INTO v_row FROM community_posts
      WHERE author_id = p_author_id
        AND content = p_content
        AND COALESCE(sport_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_sport_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND COALESCE(post_type, 'general') = COALESCE(p_post_type, 'general')
        AND created_at > now() - (GREATEST(p_backstop_seconds, 0) * interval '1 second')
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN RETURN NEXT v_row; RETURN; END IF;
  END IF;

  -- SC-434: the 5-posts-a-month cap stood here. Removed — there are no tiers.

  INSERT INTO community_posts (
    author_id, content, image_url, link_url, sport_id, city_id,
    post_type, mentions, poll_options, scheduled_at, client_key, match_id
  )
  VALUES (
    p_author_id, p_content, p_image_url, p_link_url, p_sport_id, p_city_id,
    COALESCE(p_post_type, 'general'), COALESCE(p_mentions, '{}'::uuid[]),
    p_poll_options, p_scheduled_at, p_client_key, p_match_id
  )
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION create_profile_post_capped(
  p_author_id  UUID,
  p_is_premium BOOLEAN,
  p_content    TEXT,
  p_media_urls TEXT[],
  p_link_url   TEXT,
  p_client_key UUID DEFAULT NULL
)
RETURNS SETOF profile_posts AS $$
DECLARE
  v_row profile_posts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM profile_posts
      WHERE author_id = p_author_id AND client_key = p_client_key LIMIT 1;
    IF FOUND THEN RETURN NEXT v_row; RETURN; END IF;
  END IF;

  -- SC-434: the shared 5-posts-a-month cap stood here. Removed.

  INSERT INTO profile_posts (author_id, content, media_urls, link_url, client_key)
  VALUES (p_author_id, COALESCE(p_content, ''), p_media_urls, p_link_url, p_client_key)
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql;
