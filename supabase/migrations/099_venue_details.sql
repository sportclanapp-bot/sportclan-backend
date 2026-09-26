-- ===========================================================================
-- 099 · APPLY · venue details the "Add venue" form already asks for
-- (visual review B07, decided 27 Sep 2026: store them)
--
-- THE BUG. The Add venue form asks for Address, City, Sport, Surface and a
-- Cover photo. The venues table has only name and city_id, and POST /venues
-- read only those two — so everything else was thrown away on Save, and the
-- typed City was never matched to a city.
--
-- THE FIX. Four nullable columns. No default → no table rewrite; every
-- existing venue reads as "no details yet". The backend deployed with this
-- (BE-2) writes and reads them, so APPLY THIS BEFORE THE BE-2 DEPLOY.
--
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · count first.
-- Expected: venues = (current count), new_columns_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM venues) AS venues,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues'
      AND column_name IN ('address', 'sport_id', 'surface', 'image_url')) AS new_columns_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · the four columns. Idempotent.
-- sport_id references sports and is cleared (not the venue) if a sport row is
-- ever removed.
-- ---------------------------------------------------------------------------
ALTER TABLE venues ADD COLUMN IF NOT EXISTS address   text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS sport_id  uuid REFERENCES sports(id) ON DELETE SET NULL;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS surface   text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS image_url text;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify. Expected: new_columns = 4, venues unchanged
-- from block 1, with_details = 0 (nothing is filled in by the migration).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues'
      AND column_name IN ('address', 'sport_id', 'surface', 'image_url')) AS new_columns,
  (SELECT count(*) FROM venues) AS venues,
  (SELECT count(*) FROM venues
    WHERE address IS NOT NULL OR sport_id IS NOT NULL OR surface IS NOT NULL OR image_url IS NOT NULL) AS with_details;
