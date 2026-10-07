-- 131 · Stage 9 · T9 (Oct 2026): a default ("def."), any sport with a
-- conduct ladder (tennis, badminton, table tennis, pickleball, volleyball). The
-- referee or organiser defaults a player or side during play — the other side
-- wins with the score as it stood (like a retirement; the reason is kept in
-- score_summary.defaulted). Widens the check only: existing rows keep theirs.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_result_type_check;
ALTER TABLE matches ADD CONSTRAINT matches_result_type_check
  CHECK (result_type IS NULL OR result_type IN ('decisive', 'draw', 'walkover', 'retired', 'awarded', 'default'));
