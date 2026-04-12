-- Tournament officials (umpires, scorers, commentators)
CREATE TABLE IF NOT EXISTS tournament_officials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('umpire', 'scorer', 'commentator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tournament_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_tournament_officials_tid ON tournament_officials(tournament_id);
