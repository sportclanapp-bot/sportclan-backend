-- CricHeroes parity: MVP, availability, event audit log

-- MVP on matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS mvp_user_id UUID REFERENCES users(id);

-- Per-match squad availability
CREATE TABLE IF NOT EXISTS match_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'maybe' CHECK (status IN ('available', 'unavailable', 'maybe')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_availability_match ON match_availability(match_id);

-- Scoring event audit log for edits
CREATE TABLE IF NOT EXISTS match_event_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES match_events(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES users(id),
  old_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  action TEXT NOT NULL CHECK (action IN ('edit', 'delete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
