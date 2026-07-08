-- 053: idempotency for create-post + create-comment (SC-130, MED). Same family as
-- send_gift (052): an idempotency key (per client tap) dedups retries, while a
-- deliberate repost (new tap = new key) still creates. No-key sends use a SHORT
-- (~2s) backstop keyed on (author + content + context) so a near-instant retry is
-- caught but a deliberate repost minutes later is not. Posts/comments are
-- legitimately repeatable, so the window MUST be short + context-keyed.
--
-- 052 was the prior migration → this is 053.

-- Preflight (SC-116 lesson): confirm the columns the dedup keys on exist.
-- Expect community_posts (5) + post_comments (4) rows.
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='community_posts' AND column_name IN ('author_id','content','sport_id','post_type','created_at'))
   OR (table_name='post_comments'   AND column_name IN ('post_id','author_id','content','created_at'))
ORDER BY table_name, column_name;

-- ── Idempotency-key columns + partial unique indexes (enforced only when a key is set).
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_posts_author_client_key
  ON community_posts (author_id, client_key) WHERE client_key IS NOT NULL;

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_comments_author_client_key
  ON post_comments (author_id, client_key) WHERE client_key IS NOT NULL;

-- ── Extend create_post_capped with idempotency. The arg list changes, so DROP the
--    old 11-arg signature first (avoids an ambiguous PostgREST overload), then
--    recreate with p_client_key + p_backstop_seconds. Monthly-cap logic unchanged.
DROP FUNCTION IF EXISTS create_post_capped(uuid, boolean, text, text, text, uuid, uuid, text, uuid[], jsonb, timestamptz);

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
  p_backstop_seconds NUMERIC DEFAULT 2
)
RETURNS SETOF community_posts AS $$
DECLARE
  v_row community_posts;
  v_count INT;
BEGIN
  -- Serialize per author so dedup + cap + insert are race-safe.
  PERFORM pg_advisory_xact_lock(hashtext(p_author_id::text));

  -- Idempotency dedup BEFORE the cap check + insert — a retry must NOT burn a cap slot.
  IF p_client_key IS NOT NULL THEN
    SELECT * INTO v_row FROM community_posts
      WHERE author_id = p_author_id AND client_key = p_client_key LIMIT 1;
    IF FOUND THEN RETURN NEXT v_row; RETURN; END IF;
  ELSE
    -- No-key backstop: identical post by the same author on the same context within the window.
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

  -- Monthly cap (non-premium) — IST calendar month, unchanged from 047.
  IF NOT COALESCE(p_is_premium, FALSE) THEN
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
    post_type, mentions, poll_options, scheduled_at, client_key
  )
  VALUES (
    p_author_id, p_content, p_image_url, p_link_url, p_sport_id, p_city_id,
    COALESCE(p_post_type, 'general'), COALESCE(p_mentions, '{}'::uuid[]),
    p_poll_options, p_scheduled_at, p_client_key
  )
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql;
