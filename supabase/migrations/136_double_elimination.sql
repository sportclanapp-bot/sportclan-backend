-- 136 · Stage 11 · PB4 (Oct 2026): double elimination, every knockout sport —
-- a knockout (or the knockout of groups → knockout) where a side is out only
-- after a second loss. The main draw is the usual bracket (bracket NULL); its
-- losers drop into a back draw; the back draw's winner meets the main draw's
-- winner in the final, and if the back-draw side wins it, a reset final is
-- played (cancelled when it isn't needed).
--   loser_next_match_id / loser_next_slot: where a main-draw match's LOSER goes
--     (a back-draw match, or the final for a two-entry draw); NULL elsewhere.
--   bracket: 'back' (the back draw), 'final', 'reset' (the final if needed);
--     NULL = the main draw / any other fixture, as before.
-- Additive, nullable, no backfill: every existing match keeps NULLs and plays
-- as before.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_match_id uuid REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_slot text;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_loser_next_slot_check;
ALTER TABLE matches ADD CONSTRAINT matches_loser_next_slot_check CHECK (loser_next_slot IS NULL OR loser_next_slot IN ('A', 'B'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS bracket text;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_bracket_check;
ALTER TABLE matches ADD CONSTRAINT matches_bracket_check CHECK (bracket IS NULL OR bracket IN ('back', 'final', 'reset'));
CREATE INDEX IF NOT EXISTS idx_matches_loser_next_match_id ON matches (loser_next_match_id) WHERE loser_next_match_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
