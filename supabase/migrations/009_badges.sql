-- Badges catalogue
CREATE TABLE IF NOT EXISTS badges (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL,
  emoji       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'general',
  threshold   INT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User badges (junction)
CREATE TABLE IF NOT EXISTS user_badges (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   UUID        NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id)
);

CREATE INDEX idx_ub_user ON user_badges (user_id);

-- Seed 6 badges
INSERT INTO badges (slug, name, description, emoji, category, threshold) VALUES
  ('first_match',   'First Match',    'Played your first match',                     '🏏', 'matches',   1),
  ('ten_matches',   'Veteran',        'Played 10 matches',                           '🎖️', 'matches',  10),
  ('fifty_matches', 'Legend',         'Played 50 matches',                           '🏆', 'matches',  50),
  ('first_win',     'Winner',         'Won your first match',                        '🥇', 'wins',      1),
  ('ten_wins',      'Champion',       'Won 10 matches',                              '👑', 'wins',     10),
  ('community_star','Community Star', 'Created 20 community posts',                  '⭐', 'community',20)
ON CONFLICT (slug) DO NOTHING;
