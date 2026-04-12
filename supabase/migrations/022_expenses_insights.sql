-- Team expense manager
CREATE TABLE IF NOT EXISTS team_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id),
  tournament_id UUID REFERENCES tournaments(id),
  title TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  category TEXT CHECK (category IN ('ground', 'registration', 'food', 'uniform', 'equipment', 'travel', 'other')),
  paid_by UUID REFERENCES users(id),
  split_among UUID[] DEFAULT '{}',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_expenses_team ON team_expenses(team_id);

-- Home vs Away tournaments
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS home_away BOOLEAN NOT NULL DEFAULT false;
