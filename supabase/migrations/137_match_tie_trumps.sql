-- 137 · Stage 11 follow-up (Oct 2026): the trump match — badminton's PBL, any
-- tie sport. Before a tie each side picks one of its matches with its order;
-- that match counts double for the side that picked it. The organiser turns it
-- on per tie format (rules.tie.trump).
-- A table of its own, not a matches column: a side's pick stays hidden from the
-- other side until both orders are in (like the orders), and the match lists
-- read every matches column. Only the tie's own endpoints and the score rebuild
-- read this. One pick per side; it can change until the tie starts (the row is
-- replaced). Additive: a new table, nothing else changes.
CREATE TABLE IF NOT EXISTS match_tie_trumps (
  match_id    uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_side   text NOT NULL CHECK (team_side IN ('A', 'B')),
  rubber_key  text NOT NULL CHECK (char_length(rubber_key) BETWEEN 1 AND 8),
  picked_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  picked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, team_side)
);
ALTER TABLE match_tie_trumps ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
