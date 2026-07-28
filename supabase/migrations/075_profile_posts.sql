-- SC-356 · PROFILE POSTS — a personal, Instagram-style post on your own profile.
--
-- Deliberately a SEPARATE table from community_posts, not a flag on it: a profile
-- post must never reach the Community feed and a community post must never reach
-- a profile wall. Two tables makes that structural rather than a filter someone
-- can forget (the community feed's own queries can't see this table at all).
--
-- Likes and comments get their own tables for the same reason — post_likes /
-- post_comments FK to community_posts, so they physically cannot hold a profile
-- post's engagement.

CREATE TABLE IF NOT EXISTS profile_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Empty string allowed: an image-only post is legitimate here (unlike a
  -- community post, which requires text). The controller enforces
  -- "text OR at least one image".
  content       text NOT NULL DEFAULT '' CHECK (char_length(content) <= 500),
  media_urls    text[],
  link_url      text,
  likes_count   integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  -- SC-130/SC-179 pattern: per-attempt idempotency key so a retry can't double-post.
  client_key    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The only read path is "this author's wall, newest first" — index the exact
-- (author, created_at DESC, id DESC) tuple the keyset pagination orders on.
CREATE INDEX IF NOT EXISTS idx_profile_posts_author_created
  ON profile_posts(author_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS profile_post_likes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_post_likes_post ON profile_post_likes(post_id);

CREATE TABLE IF NOT EXISTS profile_post_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_post_comments_post
  ON profile_post_comments(post_id, created_at);

-- Count caches, maintained by trigger exactly like community_posts' (migration
-- 005) — so a reader never pays for a COUNT(*) and the numbers can't drift from
-- whatever the API happened to compute that request.
CREATE OR REPLACE FUNCTION bump_profile_post_likes() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE profile_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE profile_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_post_likes ON profile_post_likes;
CREATE TRIGGER trg_profile_post_likes
  AFTER INSERT OR DELETE ON profile_post_likes
  FOR EACH ROW EXECUTE FUNCTION bump_profile_post_likes();

CREATE OR REPLACE FUNCTION bump_profile_post_comments() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE profile_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE profile_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_post_comments ON profile_post_comments;
CREATE TRIGGER trg_profile_post_comments
  AFTER INSERT OR DELETE ON profile_post_comments
  FOR EACH ROW EXECUTE FUNCTION bump_profile_post_comments();

COMMENT ON TABLE profile_posts IS
  'SC-356: personal profile-wall posts. Separate from community_posts by design — never appears in the Community feed. Shares the 5/month free-tier cap with community posts (enforced in the controller).';

-- ── Shared 5/month cap ───────────────────────────────────────────────────────
-- The free-tier limit is 5 posts per IST month COMBINED across community and
-- profile posts. Without this, the two features would each allow 5 and a free
-- user would get 10. Replaces the 057 definition; the ONLY change is that the
-- cap counts both tables (body otherwise byte-identical, including the advisory
-- lock, the idempotency dedup before the cap, and the match_id insert).
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
  v_count INT;
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

  -- SC-356: community + profile posts share the allowance.
  IF NOT COALESCE(p_is_premium, FALSE) THEN
    SELECT (
      (SELECT count(*) FROM community_posts
        WHERE author_id = p_author_id
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))
      +
      (SELECT count(*) FROM profile_posts
        WHERE author_id = p_author_id
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))
    ) INTO v_count;
    IF v_count >= 5 THEN
      RAISE EXCEPTION 'POST_LIMIT_REACHED';
    END IF;
  END IF;

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

-- Mirror of the same rule for the profile-post side, so BOTH creates are
-- race-safe and count the same two tables.
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
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM profile_posts
      WHERE author_id = p_author_id AND client_key = p_client_key LIMIT 1;
    IF FOUND THEN RETURN NEXT v_row; RETURN; END IF;
  END IF;

  IF NOT COALESCE(p_is_premium, FALSE) THEN
    SELECT (
      (SELECT count(*) FROM community_posts
        WHERE author_id = p_author_id
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))
      +
      (SELECT count(*) FROM profile_posts
        WHERE author_id = p_author_id
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))
    ) INTO v_count;
    IF v_count >= 5 THEN
      RAISE EXCEPTION 'POST_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO profile_posts (author_id, content, media_urls, link_url, client_key)
  VALUES (p_author_id, COALESCE(p_content, ''), p_media_urls, p_link_url, p_client_key)
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql;
