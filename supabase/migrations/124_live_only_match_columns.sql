-- 124 · Three matches columns that exist on live but were never in a migration
-- (found Oct 2026 when building a local database from the migrations: the
-- toss endpoints and SC-415's completion stamp were added in the dashboard).
-- IF NOT EXISTS: a no-op on live; a fresh database now matches live.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS toss_winner_team_id uuid;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS toss_choice text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS completed_at timestamptz;
