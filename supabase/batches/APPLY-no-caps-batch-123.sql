-- ============================================================================
-- SportClan · no app-imposed caps on quantities (Oct 2026)
-- One batch in three parts. Run A, then B, then C, in the Supabase SQL editor.
-- A and C are each ONE read-only query that returns ONE row.
-- Prepared Oct 2026. Nothing here has been run.
--
-- What changes (and nothing else):
--   123  tournaments.event_order: the 0–99 CHECK goes (it capped a tournament
--        at 100 events); the column widens from smallint to integer; a new
--        CHECK keeps it from being negative.
-- It must be applied BEFORE the backend deploy that removes the events cap
-- (the "no caps" backend commit): otherwise the 101st event of a tournament
-- fails to save. Existing rows keep their values (the old CHECK held them to 0–99).
-- No other cap lives in the database (the search found only this one).
-- ============================================================================


-- ============================================================================
-- PART A · READ-ONLY CHECK (one row; changes nothing)
-- Expect: range_check_present true · nonneg_check_present false ·
--         event_order_type smallint · range_check_def mentions 0 AND 99
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_event_order_range')  AS range_check_present,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_event_order_nonneg') AS nonneg_check_present,
  (SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'event_order') AS event_order_type,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tournaments_event_order_range') AS range_check_def;


-- ============================================================================
-- PART B · CHANGES DATA (schema only; no rows are edited)
-- ============================================================================
BEGIN;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_event_order_range;
ALTER TABLE tournaments ALTER COLUMN event_order TYPE integer;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_event_order_nonneg;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_order_nonneg
  CHECK (event_order IS NULL OR event_order >= 0);
COMMIT;


-- ============================================================================
-- PART C · READ-ONLY VERIFY (one row; changes nothing)
-- Expect: range_check_present false · nonneg_check_present true ·
--         event_order_type integer · nonneg_check_def CHECK (… event_order >= 0)
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_event_order_range')  AS range_check_present,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_event_order_nonneg') AS nonneg_check_present,
  (SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'event_order') AS event_order_type,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tournaments_event_order_nonneg') AS nonneg_check_def;
