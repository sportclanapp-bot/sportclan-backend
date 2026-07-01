-- 033_bracket_topology.sql
--
-- Persist knockout-bracket topology on `matches` so a tournament can actually
-- be run end-to-end (SC-22/23/24). Before this, bracket structure was *inferred*
-- at read time from scheduled_at order + a hard-coded {QF:4,SF:2,F:1} count
-- heuristic (only correct for ~8-team brackets), and nothing linked a match to
-- its next round — so winners never advanced.
--
--   round         1-based round number (final = highest). 0 = group stage for
--                 groups_knockout. NULL for non-bracket formats (round_robin).
--   match_no      0-based position of the match within its round (stable sort).
--   group_label   'A'/'B'/... for groups_knockout group-stage matches; NULL for
--                 knockout bracket matches. (tournament_entries also carries this.)
--   next_match_id the match this one's winner feeds into (NULL for the final).
--   next_slot     which slot of next_match_id the winner fills: 'A' or 'B'.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS round int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_no int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_label text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_id uuid REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_slot text CHECK (next_slot IN ('A', 'B'));

-- Fast lookup of a tournament's bracket in (round, match_no) order.
CREATE INDEX IF NOT EXISTS idx_matches_tournament_bracket
  ON matches (tournament_id, round, match_no);

-- Fast "who feeds this match" / advancement lookups.
CREATE INDEX IF NOT EXISTS idx_matches_next_match_id
  ON matches (next_match_id);
