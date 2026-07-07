-- 047: free-tier post-cap counts the IST calendar month (SC-90).
-- create_post_capped (040) counted `created_at >= date_trunc('month', now())`,
-- which truncates in the DB session tz (UTC) — so for India (IST, UTC+5:30)
-- users, posts made 00:00–05:30 IST on the 1st were counted against the PREVIOUS
-- month, off by the tz offset at the boundary. This recreates the function with a
-- timezone-EXPLICIT IST month boundary (correct regardless of session tz):
--   now() AT TIME ZONE 'Asia/Kolkata'                  -> IST wall-clock (naive ts)
--   date_trunc('month', <that>)                        -> IST month start (naive)
--   <that> AT TIME ZONE 'Asia/Kolkata'                 -> back to the UTC instant
-- Only the WHERE month predicate changes vs 040; everything else is identical.
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
    PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

    SELECT count(*) INTO v_count
    FROM community_posts
    WHERE author_id = p_author_id
      AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');

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
