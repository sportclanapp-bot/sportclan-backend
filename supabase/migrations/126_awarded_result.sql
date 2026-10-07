-- 126 · Stage 8 · F12 (Oct 2026): an awarded result, any sport. The organiser
-- gives a match to one side (a no-show, an ineligible player, an abandonment
-- the committee decides) — the winner, an optional score (football's 3–0) and
-- the reason (in score_summary.decision). Additive: existing rows keep theirs.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_result_type_check;
ALTER TABLE matches ADD CONSTRAINT matches_result_type_check
  CHECK (result_type IS NULL OR result_type IN ('decisive', 'draw', 'walkover', 'retired', 'awarded'));
