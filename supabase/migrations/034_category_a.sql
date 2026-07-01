-- 034_category_a.sql
--
-- Schema for the Category-A feature batch:
--   • match_followers            — "follow a match" for score/completion updates
--   • matches.chat_id            — per-match group chat (mirrors tournament chat)
--   • users.checkin_streak/date  — daily check-in streak (separate from match streak)
--   • users privacy columns      — discoverability / message / tag visibility
--   • notification_sends         — per-day dedupe guard for the scheduled jobs
--
-- All additive + idempotent (IF NOT EXISTS). Safe to run before the code deploys.

-- ── Follow a match ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_followers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_followers_match ON match_followers (match_id);
CREATE INDEX IF NOT EXISTS idx_match_followers_user  ON match_followers (user_id);

-- ── Per-match group chat ─────────────────────────────────────────────────────
ALTER TABLE matches ADD COLUMN IF NOT EXISTS chat_id uuid REFERENCES chats(id) ON DELETE SET NULL;

-- ── Daily check-in streak (distinct from the match-play streak_count) ─────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_streak   int  NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_date date;

-- ── Privacy / visibility controls ────────────────────────────────────────────
-- everyone = anyone · followers = only my followers · nobody = hidden/blocked.
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverability text NOT NULL DEFAULT 'everyone'
  CHECK (discoverability IN ('everyone', 'followers', 'nobody'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS message_privacy text NOT NULL DEFAULT 'everyone'
  CHECK (message_privacy IN ('everyone', 'followers', 'nobody'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS tag_privacy text NOT NULL DEFAULT 'everyone'
  CHECK (tag_privacy IN ('everyone', 'followers', 'nobody'));

-- ── Scheduled-job dedupe (smart-match / re-engagement / weekly-digest) ────────
-- One row per (user, job type, calendar day); the jobs insert-or-skip so a
-- double-fire (multi-instance / overlapping run) can't double-send a push.
CREATE TABLE IF NOT EXISTS notification_sends (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type   text NOT NULL,
  sent_on    date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_type, sent_on)
);
CREATE INDEX IF NOT EXISTS idx_notification_sends_lookup ON notification_sends (job_type, sent_on);
