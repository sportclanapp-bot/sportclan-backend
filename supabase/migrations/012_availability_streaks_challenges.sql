-- Migration 012 — UX upgrades:
--   * Available-to-play toggle (batch 5)
--   * Activity streaks (batch 6)
--   * Monthly challenges (batch 8)
--   * Open matches (batch 10)
-- All additive / idempotent — safe to re-run.

-- ─── Batch 5: Available to play ────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT false;

-- ─── Batch 6: Activity streaks ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_match_date DATE;

-- ─── Batch 8: Monthly challenges ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  sport_id          UUID REFERENCES sports(id) ON DELETE SET NULL,
  target_count      INTEGER NOT NULL,
  reward_coins      INTEGER NOT NULL DEFAULT 0,
  reward_badge_slug TEXT,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(active, ends_at);

CREATE TABLE IF NOT EXISTS user_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id  UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  progress      INTEGER NOT NULL DEFAULT 0,
  completed     BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, challenge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_challenges_user ON user_challenges(user_id);

-- Seed three launch challenges for the current month. Dates are the first
-- and last day of April 2026 (current month per CLAUDE.md). The cricket
-- challenge is looked up by slug 'cricket'; if sports seed differs this
-- gracefully leaves sport_id NULL.
INSERT INTO challenges (title, description, sport_id, target_count, reward_coins, reward_badge_slug, starts_at, ends_at)
SELECT 'April Warrior', 'Play 5 matches this month', NULL, 5, 50, NULL,
       '2026-04-01 00:00:00+00', '2026-04-30 23:59:59+00'
WHERE NOT EXISTS (SELECT 1 FROM challenges WHERE title = 'April Warrior');

INSERT INTO challenges (title, description, sport_id, target_count, reward_coins, reward_badge_slug, starts_at, ends_at)
SELECT 'Cricket Master', 'Score 50+ runs in a match',
       (SELECT id FROM sports WHERE LOWER(name) = 'cricket' LIMIT 1),
       1, 30, 'cricket_master',
       '2026-04-01 00:00:00+00', '2026-04-30 23:59:59+00'
WHERE NOT EXISTS (SELECT 1 FROM challenges WHERE title = 'Cricket Master');

INSERT INTO challenges (title, description, sport_id, target_count, reward_coins, reward_badge_slug, starts_at, ends_at)
SELECT 'Community Star', 'Post 3 community posts', NULL, 3, 20, NULL,
       '2026-04-01 00:00:00+00', '2026-04-30 23:59:59+00'
WHERE NOT EXISTS (SELECT 1 FROM challenges WHERE title = 'Community Star');

-- ─── Batch 10: Open matches / find a game ─────────────────────────────────
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS players_needed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_matches_open ON matches(is_open, scheduled_at) WHERE is_open = true;
