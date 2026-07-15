-- 062_tournament_scheduling.sql
-- FEATURE: tournament & match scheduling. Organisers run 1/2/3-day tournaments
-- based on team count + how long they've booked the ground. Fixture generation
-- now slots each fixture into a real date + time + ground computed from these.
--
-- All columns are OPTIONAL — absent → fixture-gen uses a graceful sequential
-- fallback (single ground, from start_date), so create/generate still work.
-- Forward-only: existing tournaments/matches are untouched.
--
-- Grounds: ground_count drives capacity; ground_names[i] names them ("MCA Pitch
-- 1") else the scheduler labels "Ground N". (A single daily window applies to all
-- days in v1; per-day overrides are a later enhancement.)
--
-- MUST be applied BEFORE the backend deploy: generate-fixtures reads AND writes
-- these columns (daily_start_time … + matches.ground_label).

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS daily_start_time      TIME,
  ADD COLUMN IF NOT EXISTS daily_end_time        TIME,
  ADD COLUMN IF NOT EXISTS match_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS buffer_minutes        INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ground_count          INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ground_names          TEXT[];

-- Per-match resolved ground label ("Ground 2" / "Turf A"), denormalized so the
-- fixture list / bracket render it with no join. scheduled_at (already timestamptz)
-- carries the date + time.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ground_label TEXT;
