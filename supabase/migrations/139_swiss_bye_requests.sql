-- 139 · Stage 12 follow-up (Oct 2026): a player asks for a bye in a Swiss —
-- half a point, none, or absent — for a round not yet paired, up to the round
-- the organiser allows. The organiser or an arbiter approves or declines it on
-- the Pairings desk; approved ones join the round's byes (tournaments.settings
-- .swiss.requests, as the organiser's own). Every sport that offers Swiss.
-- One open (pending or approved) request per entry and round. Additive: a new
-- table, nothing else changes.
CREATE TABLE IF NOT EXISTS swiss_bye_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round          integer NOT NULL CHECK (round >= 1),
  kind           text NOT NULL CHECK (kind IN ('half', 'zero', 'absent')),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  note           text CHECK (note IS NULL OR char_length(note) <= 200),
  requested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS swiss_bye_requests_open ON swiss_bye_requests (tournament_id, team_id, round) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS swiss_bye_requests_tournament ON swiss_bye_requests (tournament_id, status);
ALTER TABLE swiss_bye_requests ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
