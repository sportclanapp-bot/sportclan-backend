-- SC-368 · codify the `venues` table.
--
-- WHY: the table is live in prod but NO migration ever created it, so an
-- environment rebuilt from this repo had no `venues` and both /venues endpoints
-- 500'd. This makes a from-scratch run match production.
--
-- SAFETY: every statement is IF NOT EXISTS, so applying this to prod — which
-- already has the table and its rows — is a no-op. It deliberately adds NO
-- constraint that could FAIL against existing data (see the note on uniqueness
-- at the bottom); a migration whose job is to document reality must not be able
-- to reject reality.
--
-- PROVENANCE (stated honestly): I could not read prod's catalog from here, so
-- the column list and types below come from what the live API demonstrably
-- returns and what the controller queries:
--   POST /venues → { id: uuid, name: text, city_id: uuid|null, created_by: uuid,
--                    use_count: int, created_at: timestamptz }
--   venues.controller: ilike(name), eq(city_id), order(use_count desc)
-- `VERIFY-sc368-introspect-drifted-tables.sql` prints the real catalog; if it
-- disagrees with anything here, prod wins and this file should be corrected.

CREATE TABLE IF NOT EXISTS venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Nullable and observed null: venues are created without a city today
  -- (the match form doesn't pass one).
  city_id    uuid REFERENCES cities(id) ON DELETE SET NULL,
  -- Reuse counter. upsertVenue increments it instead of inserting a duplicate.
  use_count  integer NOT NULL DEFAULT 1,
  -- SET NULL rather than CASCADE: deleting the account that first typed a
  -- ground name must not delete the ground everyone else now uses.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes the reuse path actually needs ───────────────────────────────────
-- upsertVenue's dedupe is `ilike(name, <exact>)`, optionally + eq(city_id).
-- A plain btree on name can't serve a case-insensitive match, so index the
-- lowered expression — that is the one the dedupe lookup can use.
CREATE INDEX IF NOT EXISTS idx_venues_lower_name ON venues (lower(name));

-- searchVenues lists by popularity, optionally scoped to a city.
CREATE INDEX IF NOT EXISTS idx_venues_city_use_count ON venues (city_id, use_count DESC);

COMMENT ON TABLE venues IS
  'SC-368: reuse dictionary of venue names (NOT a booking entity — venue on a match is the free-text matches.venue column). Codified retroactively; the table predates this migration in prod.';

-- ── NOT added here, deliberately ────────────────────────────────────────────
-- A UNIQUE index on lower(name) is what would actually GUARANTEE the dedupe
-- that upsertVenue currently only does best-effort in application code (two
-- concurrent creates of the same name can still race today). It is omitted
-- because CREATE UNIQUE INDEX fails outright if prod already holds a
-- case-duplicate pair, which would turn this safe no-op into a failed
-- migration. A 10-row sample showed no duplicates, but that is not proof.
-- Gate it on the introspection output, then apply separately:
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_venues_lower_name
--     ON venues (lower(name)) WHERE city_id IS NULL;
--   -- (and an equivalent partial index per-city if venues become city-scoped)
