-- 128 · Stage 8 · F21 (Oct 2026): the organiser's announcements, any sport —
-- "Pitch 2 is running 20 minutes late", "the final is at 6 pm". Each reaches
-- every entrant's players, the co-organisers and the officials as a push, and
-- stays on the tournament's page. Soft delete (deleted_at); never hard-deleted.
CREATE TABLE IF NOT EXISTS tournament_announcements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS tournament_announcements_live ON tournament_announcements (tournament_id, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE tournament_announcements ENABLE ROW LEVEL SECURITY;
