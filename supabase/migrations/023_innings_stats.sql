-- Per-innings cricket batting/bowling/fielding stats
CREATE TABLE IF NOT EXISTS innings_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  innings_number INTEGER NOT NULL DEFAULT 1,
  runs INTEGER NOT NULL DEFAULT 0,
  balls_faced INTEGER NOT NULL DEFAULT 0,
  fours INTEGER NOT NULL DEFAULT 0,
  sixes INTEGER NOT NULL DEFAULT 0,
  is_out BOOLEAN NOT NULL DEFAULT false,
  dismissal_type TEXT,
  bowling_overs NUMERIC(4,1) DEFAULT 0,
  bowling_runs INTEGER DEFAULT 0,
  bowling_wickets INTEGER DEFAULT 0,
  bowling_maidens INTEGER DEFAULT 0,
  catches INTEGER DEFAULT 0,
  runouts INTEGER DEFAULT 0,
  stumpings INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(match_id, user_id, innings_number)
);
CREATE INDEX IF NOT EXISTS idx_innings_stats_user ON innings_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_innings_stats_match ON innings_stats(match_id);

-- Tennis/Badminton/TT serve and point stats on match_participants
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS aces INTEGER DEFAULT 0;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS double_faults INTEGER DEFAULT 0;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS first_serve_in INTEGER DEFAULT 0;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS first_serve_total INTEGER DEFAULT 0;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS break_points_won INTEGER DEFAULT 0;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS break_points_faced INTEGER DEFAULT 0;
