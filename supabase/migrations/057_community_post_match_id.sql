-- 057 · SC-193 — match-result posts with an embedded scorecard.
--
-- Adds a nullable match_id FK to community_posts so a "share result" post can
-- link to the REAL completed match it reports. Nullable + ON DELETE SET NULL →
-- every existing post is unaffected (match_id defaults NULL and renders as a
-- normal post; deleting a match nulls the link rather than the post).
--
-- The insert path is the atomic create_post_capped RPC, so we re-issue it
-- (mirroring the 053 body EXACTLY) adding ONLY the new p_match_id param + the
-- match_id INSERT column. Everything else — advisory lock, idempotency dedup,
-- IST monthly cap — is byte-for-byte unchanged from 053.

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES matches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_posts_match ON community_posts (match_id);

-- Re-issue the RPC. Drop the current 13-arg signature first (avoids an ambiguous
-- PostgREST overload), then recreate with a trailing p_match_id (trailing so the
-- defaulted-params-last rule holds; supabase-js calls by NAME so position is
-- cosmetic).
DROP FUNCTION IF EXISTS create_post_capped(uuid, boolean, text, text, text, uuid, uuid, text, uuid[], jsonb, timestamptz, uuid, numeric);

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
