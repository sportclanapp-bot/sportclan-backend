-- ===========================================================================
-- 097 · APPLY · the is_test_seed flag on the six root tables + venues (visual review B03)
--
-- Decision D3: test content is HIDDEN from every public surface now and deleted
-- at the launch wipe. The flag is what both steps key on. This is
-- SQL files/MIGRATION-033-test-seed-flag.sql brought into the repo, because it
-- is not known whether 033 was ever applied to prod. Every statement is
-- idempotent (IF NOT EXISTS), so running it on a database that already has the
-- columns changes nothing. Constant DEFAULT false → no table rewrite.
-- venues is new here (not in 033): the venues directory listed "S2 probe ground"
-- and other test venues, and a venue has no other way to be told apart.
--
-- Must be applied BEFORE the BE-1 deploy: the backend filters on this column.
-- Each block runs on its own. Block 1 only reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only): which tables already have the column.
-- 6 rows = 033 was applied (venues is always new); fewer = block 2 adds them.
-- ---------------------------------------------------------------------------
SELECT table_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_test_seed'
ORDER BY table_name;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · Add the columns and partial indexes (idempotent).
-- ---------------------------------------------------------------------------
ALTER TABLE users            ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE teams            ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE matches          ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE tournaments      ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE community_posts  ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE chats            ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
ALTER TABLE venues           ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_test_seed   ON users(id)           WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_teams_test_seed   ON teams(id)           WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_matches_test_seed ON matches(id)         WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_tourn_test_seed   ON tournaments(id)     WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_posts_test_seed   ON community_posts(id) WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_chats_test_seed   ON chats(id)           WHERE is_test_seed;
CREATE INDEX IF NOT EXISTS idx_venues_test_seed  ON venues(id)          WHERE is_test_seed;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Verify. Expected: 7 rows, boolean, NOT NULL ('NO'), default false.
-- ---------------------------------------------------------------------------
SELECT table_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_test_seed'
ORDER BY table_name;
