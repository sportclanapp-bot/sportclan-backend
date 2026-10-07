-- 127 · Stage 8 · F3 / F16 (Oct 2026): a team's squad for a tournament, any
-- sport whose entries are teams. Each player is an account (user_id) or a name
-- (guest_name), with an optional shirt number, and the organiser's ID check
-- (who checked, when, a note — e.g. "birth certificate seen"). Soft delete:
-- removed_at; never hard-deleted. A team without squad rows plays with its
-- members as before. The squad size and when it locks are the organiser's
-- optional choices (tournaments.settings.squad).
CREATE TABLE IF NOT EXISTS tournament_squads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_name     text CHECK (guest_name IS NULL OR char_length(guest_name) BETWEEN 1 AND 60),
  jersey_number  integer CHECK (jersey_number IS NULL OR jersey_number >= 0),
  id_checked_at  timestamptz,
  id_checked_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  id_note        text CHECK (id_note IS NULL OR char_length(id_note) <= 200),
  added_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  CONSTRAINT tournament_squads_who CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);
-- An account is in one squad per tournament while it stands.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_squads_user_live
  ON tournament_squads (tournament_id, user_id) WHERE removed_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tournament_squads_team ON tournament_squads (tournament_id, team_id) WHERE removed_at IS NULL;
ALTER TABLE tournament_squads ENABLE ROW LEVEL SECURITY;
