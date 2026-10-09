-- 140 · Stage 13 · CR9 (Oct 2026): a Swiss that feeds a knockout — after the
-- last round the top N of the table play a seeded knockout whose final crowns
-- the champion (settings.swiss.knockout = N). The knockout's matches are marked
-- bracket = 'ko' so they are never read as Swiss rounds.
-- Widens matches_bracket_check by one value; every existing row (NULL, 'back',
-- 'final', 'reset') still passes. No data changes.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_bracket_check;
ALTER TABLE matches ADD CONSTRAINT matches_bracket_check CHECK (bracket IS NULL OR bracket IN ('back', 'final', 'reset', 'ko'));

NOTIFY pgrst, 'reload schema';
