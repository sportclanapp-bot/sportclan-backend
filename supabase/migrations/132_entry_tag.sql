-- 132 · Stage 9 · T7 (Oct 2026): how an entry got into a draw, every knockout
-- sport — 'WC' a wild card (the organiser's choice), 'Q' a qualifier (won
-- through the linked qualifying draw), 'LL' a lucky loser (a final-round
-- qualifying loser put in for a withdrawal). Null for every existing entry
-- and for ordinary entries. Additive: a nullable column, nothing rewritten.
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS entry_tag text;
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_entry_tag_check;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_entry_tag_check
  CHECK (entry_tag IS NULL OR entry_tag IN ('WC', 'Q', 'LL'));
