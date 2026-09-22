-- SC-435 · drop the premium and payment leftovers.
--
-- SC-434 removed the tiers and the gateway from the CODE. This removes what they
-- left in the database. Coins are untouched — they were never payment machinery.
--
-- ⚠ THIS MUST BE APPLIED **AFTER** THE BACKEND IS DEPLOYED. ⚠
--
-- Dropping a column that a running query still selects makes that query fail for
-- every user who touches it. The deployed code must already have stopped reading
-- these columns, and the commit that does so is the one that must be live first.
--
-- The RPCs are the one piece that is unsafe in BOTH orders, so they are handled
-- differently. A function's SIGNATURE is its identity in Postgres: replacing
-- create_post_capped with a version that has no `p_is_premium` does not modify
-- the old function, it creates a second one — and dropping the old breaks any
-- caller still passing the argument. So the deployed controllers call the NEW
-- shape first and fall back to the old on PGRST202 ("function not found"). Before
-- this migration the fallback carries every post; after it, the first call
-- succeeds. Neither order strands anybody. (Same ladder as SC-432's
-- recordEventIdempotent, for the same reason.)
--
-- WHAT THIS DOES NOT TOUCH, deliberately:
--   * `users.coin_balance` and the whole coin ledger — `coin_events`,
--     `transactions`, `gift_transactions`. Coins are earned and spent; they were
--     never bought, so they are not payment machinery and they still work.
--   * any other column on `users`.
--
-- Everything below is irreversible. All prod data is being wiped before launch
-- (see the LAUNCH GATE note), which is why dropping rather than deprecating is
-- the right call here.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · users columns
--
-- `is_premium` + `premium_expires_at` (001) gated eight features and carried the
-- complimentary early-bird grant. `trial_used` (013) tracked a 7-day trial that
-- could only be started through a kill-switched endpoint. `last_premium_reminder_at`
-- (a later batch) throttled the "your Premium expires in 3 days" notification,
-- which no longer exists.
ALTER TABLE users
  DROP COLUMN IF EXISTS is_premium,
  DROP COLUMN IF EXISTS premium_expires_at,
  DROP COLUMN IF EXISTS trial_used,
  DROP COLUMN IF EXISTS last_premium_reminder_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · payment-only tables
--
-- `subscriptions` (006) held plan rows written by an endpoint that answered 503
-- for its entire life. `coupon_codes` / `coupon_usages` (001) backed a promo flow
-- whose last live code was retired before launch. CASCADE takes their indexes and
-- the coupon FK with them.
--
-- NOT dropped: transactions, coin_events, gift_transactions — see the header.
DROP TABLE IF EXISTS coupon_usages CASCADE;
DROP TABLE IF EXISTS coupon_codes  CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · the two post RPCs, without p_is_premium
--
-- Bodies are byte-identical to migration 090 apart from the removed parameter.
-- The advisory lock and the client_key dedup — the parts that stop a double-tap
-- becoming two posts — are unchanged.

CREATE OR REPLACE FUNCTION create_post_capped(
  p_author_id        UUID,
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

-- Drop the OLD signatures last, so the new ones exist before the old ones stop.
-- Explicit argument lists: `DROP FUNCTION name` is ambiguous with overloads.
DROP FUNCTION IF EXISTS create_post_capped(
  UUID, BOOLEAN, TEXT, TEXT, TEXT, UUID, UUID, TEXT, UUID[], JSONB, TIMESTAMPTZ, UUID, NUMERIC, UUID
);
DROP FUNCTION IF EXISTS create_profile_post_capped(
  UUID, BOOLEAN, TEXT, TEXT[], TEXT, UUID
);

COMMIT;
