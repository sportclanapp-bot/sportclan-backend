-- Migration 027 · Final polish pass schema additions
--
-- Adds the columns needed for:
--   1. Voice notes in chat (audio_url + audio_duration_ms on messages)
--   2. Admin gating (is_admin flag on users)
--   3. Content reports (full table; was implicit before)
--
-- All changes are additive — safe to re-run via IF NOT EXISTS guards.

-- 1. Voice notes
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS audio_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_duration_ms INTEGER;

-- 2. Admin gating
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = TRUE;

-- 3. Content reports table (used by /community/report + /admin/reports)
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_unresolved
  ON content_reports(created_at DESC)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON content_reports(target_type, target_id);

-- 4. Poll posts · two fields on community_posts
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS poll_options JSONB,
  ADD COLUMN IF NOT EXISTS post_type TEXT DEFAULT 'general';

-- 5. Poll votes table (for tracking who voted for what)
CREATE TABLE IF NOT EXISTS poll_votes (
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_post ON poll_votes(post_id);

-- 6. Push tokens (one per device per user)
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- 7. Scoring event player attribution
-- match_events.payload already supports arbitrary JSON via the existing
-- schema, so no DDL change needed — frontend sends { player_id } inside
-- the payload and we accept it as-is.
