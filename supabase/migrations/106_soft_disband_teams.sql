-- ===========================================================================
-- 106 · APPLY · a disbanded team is marked, not removed
-- (hard-delete list #6, decided 27 Sep 2026)
--
-- DELETE /teams/:id (the captain disbands) and the last member leaving via
-- DELETE /teams/:id/members/:userId used to delete the team row, its members
-- and every expense record. Now the team row is marked:
--   deleted_at / deleted_by / deleted_reason
--   deleted_reason  'captain_disband' | 'last_member_left'
-- and its team_members rows (the former members) and team_expenses stay.
-- Former members keep read-only access to the expense history; everything
-- else about the team answers "This team was disbanded".
--
-- (A team can only be disbanded while it has no matches and no tournament
-- entries, so no match or tournament ever points at a disbanded team.)
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet.
-- Expected: new_columns_present = 0, new_constraint_present = 0,
-- new_index_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'teams' AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason')) AS new_columns_present,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'teams_deleted_reason_check')              AS new_constraint_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_teams_live_sport')                                                     AS new_index_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · columns, check, index. Idempotent.
-- Nullable, no default → no table rewrite, no row changed.
-- ---------------------------------------------------------------------------
ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_deleted_reason_check') THEN
    ALTER TABLE teams ADD CONSTRAINT teams_deleted_reason_check
      CHECK (deleted_reason IS NULL OR deleted_reason IN ('captain_disband', 'last_member_left'));
  END IF;
END $$;

-- Team lists, search and discovery read live teams by sport.
CREATE INDEX IF NOT EXISTS idx_teams_live_sport
  ON teams (sport_id, created_at DESC) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 3 rows — teams.deleted_at timestamp with time zone YES,
-- teams.deleted_by uuid YES, teams.deleted_reason text YES; then
-- constraint_present = 1, index_present = 1.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'teams'
  AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason')
ORDER BY column_name;

SELECT
  (SELECT count(*) FROM pg_constraint WHERE conname = 'teams_deleted_reason_check') AS constraint_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_teams_live_sport')                                        AS index_present;
