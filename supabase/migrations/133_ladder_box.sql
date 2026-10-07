-- 133 · Stage 9 · T16 (Oct 2026): two more tournament formats for the racket
-- sports, chess and carrom —
--   'ladder' a challenge ladder: entries hold positions (tournament_entries.seed,
--            1 = top); a player challenges one above, a win moves them up;
--   'box'    a box league: small round-robin boxes (tournament_entries.group_label
--            is the box), promotion and relegation between rounds (matches.round).
-- The CHECK is replaced by the same list plus the two. No data change: every
-- existing tournament keeps its format.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_format_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('knockout', 'league', 'round_robin', 'groups_knockout', 'swiss', 'ladder', 'box'));

NOTIFY pgrst, 'reload schema';
