-- ===========================================================================
-- 110 · APPLY · a team's short name is stored (decided 27 Sep 2026)
--
-- New team and Edit team have always asked for a "Short name · shown on
-- scorecards", but `teams` had no column for it: the backend ignored the field,
-- so it was thrown away on save and Edit team always showed it empty. This adds
-- the column. The backend trims and upper-cases it and stores a blank as NULL;
-- the CHECK is the last line of defence for the 3-character limit the app and
-- the server both enforce. Existing teams get NULL — they keep showing their
-- name, as today.
--
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only. No row is changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet.
-- Expected: column_present = 0, constraint_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'short_name') AS column_present,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_short_name_len') AS constraint_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · one nullable column and its length check.
-- Idempotent. No default → no table rewrite, no row changed. Adding the CHECK
-- reads the table once to validate it; every row is NULL, so it passes.
-- ---------------------------------------------------------------------------
ALTER TABLE teams ADD COLUMN IF NOT EXISTS short_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_short_name_len'
  ) THEN
    ALTER TABLE teams ADD CONSTRAINT teams_short_name_len
      CHECK (short_name IS NULL OR char_length(short_name) BETWEEN 1 AND 3);
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 1 row — short_name | text | YES | CHECK (((short_name IS NULL) OR
-- ((char_length(short_name) >= 1) AND (char_length(short_name) <= 3))))
-- ---------------------------------------------------------------------------
SELECT c.column_name, c.data_type, c.is_nullable,
       pg_get_constraintdef(k.oid) AS length_check
FROM information_schema.columns c
LEFT JOIN pg_constraint k
  ON k.conrelid = 'public.teams'::regclass AND k.conname = 'teams_short_name_len'
WHERE c.table_schema = 'public' AND c.table_name = 'teams' AND c.column_name = 'short_name';
