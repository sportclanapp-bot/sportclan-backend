-- Add join_code to teams for code-based team joining
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_teams_join_code ON teams (join_code) WHERE join_code IS NOT NULL;
