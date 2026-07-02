-- 035_fixtures_generated.sql
-- SC-48: DB-level guard against the fixture-generation race. generateFixtures
-- atomically flips this false->true (Postgres row-lock serializes concurrent
-- UPDATEs), so only ONE concurrent request can ever generate fixtures.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS fixtures_generated boolean NOT NULL DEFAULT false;

-- Backfill: any tournament that already has matches is considered generated, so
-- it can't be regenerated (and pre-existing fixtures are protected).
UPDATE tournaments SET fixtures_generated = true
WHERE fixtures_generated = false
  AND id IN (SELECT DISTINCT tournament_id FROM matches WHERE tournament_id IS NOT NULL);
