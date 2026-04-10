-- User sport profiles: per-user per-sport rating and stats
CREATE TABLE IF NOT EXISTS user_sport_profiles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport_id   UUID        NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  rating     NUMERIC(7,2) NOT NULL DEFAULT 1200,
  matches_played INT     NOT NULL DEFAULT 0,
  wins       INT         NOT NULL DEFAULT 0,
  losses     INT         NOT NULL DEFAULT 0,
  draws      INT         NOT NULL DEFAULT 0,
  last_match_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sport_id)
);

CREATE INDEX idx_usp_user   ON user_sport_profiles (user_id);
CREATE INDEX idx_usp_sport  ON user_sport_profiles (sport_id);
CREATE INDEX idx_usp_rating ON user_sport_profiles (sport_id, rating DESC);

-- Rating history: every rating change is logged
CREATE TABLE IF NOT EXISTS rating_history (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport_id     UUID        NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  match_id     UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  old_rating   NUMERIC(7,2) NOT NULL,
  new_rating   NUMERIC(7,2) NOT NULL,
  delta        NUMERIC(7,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rh_user  ON rating_history (user_id, created_at DESC);
CREATE INDEX idx_rh_match ON rating_history (match_id);
