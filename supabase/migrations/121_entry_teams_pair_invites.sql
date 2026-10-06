-- 121 · teams.kind + tournament_pair_invites (badminton gap 2).
-- Applied by Dipak on 6 Oct 2026 (batch APPLY-badminton-batch-120-122.sql, part B).
-- Additive: defaults/NULL, a new table, a wider CHECK. Older apps unaffected.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'club';
ALTER TABLE teams ADD CONSTRAINT teams_kind_check CHECK (kind IN ('club', 'entry'));
COMMENT ON COLUMN teams.kind IS
  'Badminton gap 2: club = a team people make (as today); entry = made by the server for one singles or doubles entry, hidden from team lists.';

CREATE TABLE IF NOT EXISTS tournament_pair_invites (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  inviter_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id    uuid        REFERENCES users(id) ON DELETE CASCADE,
  entry_id      uuid        REFERENCES tournament_entries(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT tournament_pair_invites_status_check
    CHECK (status IN ('open', 'pending', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT tournament_pair_invites_note_len
    CHECK (note IS NULL OR char_length(note) <= 120),
  CONSTRAINT tournament_pair_invites_not_self
    CHECK (invitee_id IS NULL OR invitee_id <> inviter_id),
  CONSTRAINT tournament_pair_invites_open_shape
    CHECK (status <> 'open' OR invitee_id IS NULL),
  CONSTRAINT tournament_pair_invites_invitee_shape
    CHECK (status NOT IN ('pending', 'accepted', 'declined') OR invitee_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pair_invites_invitee
  ON tournament_pair_invites (invitee_id, status) WHERE invitee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pair_invites_tournament
  ON tournament_pair_invites (tournament_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pair_invites_live
  ON tournament_pair_invites (tournament_id, inviter_id) WHERE status IN ('open', 'pending');
ALTER TABLE tournament_pair_invites ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE tournament_pair_invites IS
  'Badminton gap 2: a doubles partner request. pending = invited, waiting; open = looking for a partner; accepted makes (or, with entry_id, changes) the pair''s entry. Service-role only.';
