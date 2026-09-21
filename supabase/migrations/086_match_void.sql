-- SC-424 · voiding a match, without deleting anything.
--
-- A match that should never have counted — a test fixture, a mis-scored game, a
-- fixture played under protest — had exactly two options before this: leave it
-- in everyone's record, or delete rows on prod. Both are wrong. Deleting loses
-- the audit trail and the events, and it is irreversible.
--
-- Voiding is the third option: the match and every one of its events stay
-- exactly where they are, and a flag says "this does not count". Every rollup
-- honours the flag, the match page says so out loud, and clearing the flag puts
-- it back. Deliberately NOT a new `status` value: status describes how the match
-- ENDED (completed / abandoned / cancelled), and a voided match still ended
-- however it ended. Orthogonal facts get orthogonal columns.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason text;

COMMENT ON COLUMN matches.voided_at IS
  'SC-424: when this match was voided. NOT NULL means every per-player, team and '
  'tournament rollup must exclude it. Clearing it restores the match.';
COMMENT ON COLUMN matches.voided_by IS 'SC-424: who voided it (organiser or admin).';
COMMENT ON COLUMN matches.void_reason IS 'SC-424: why, in the voider''s own words. Shown on the match page.';

-- Rollups filter on "not voided", which is the overwhelmingly common case, so
-- the useful index is the small partial one over the exceptions.
CREATE INDEX IF NOT EXISTS idx_matches_voided_at
  ON matches (voided_at)
  WHERE voided_at IS NOT NULL;
