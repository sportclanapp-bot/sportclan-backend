-- 135 · Stage 10 · TT1b (Oct 2026): who names A, B, C in a team tie played by
-- positions (table tennis Corbillon / Swaythling, tennis Davis Cup, badminton
-- and pickleball A v X ties). As in ITTF team events, a toss (the winner
-- chooses) or the organiser's pick, recorded before the line-ups:
--   { "abc": "A"|"B", "how": "toss"|"pick", "winner": "A"|"B" (a toss), "at": iso, "by": user id }
-- "abc" is the fixture side that names A, B, C. NULL (every existing match) =
-- the first-named side names A, B, C, as before. Additive, nullable, no backfill.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tie_toss jsonb;

NOTIFY pgrst, 'reload schema';
