-- 118 · matches.scorer_id — a scorer the organiser names for one fixture (cricket gap 3).
-- Applied by Dipak on 5 Oct 2026 (batch APPLY-gaps-batch-117-119.sql, part B).
-- The umpire already has matches.umpire_id. Additive and nullable: older apps unaffected.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS scorer_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_matches_scorer ON matches (scorer_id) WHERE scorer_id IS NOT NULL;
COMMENT ON COLUMN matches.scorer_id IS
  'Gap 3 (5 Oct 2026): the scorer the organiser named for this fixture. May score it like an organiser. NULL = none named.';
