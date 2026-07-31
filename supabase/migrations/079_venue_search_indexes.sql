-- SC-369 · make the venue lookups index-able, and add the indexes that serve them.
--
-- SC-368 measured the two hot paths and found BOTH were sequential scans, and —
-- more importantly — that adding indexes alone would have been theatre:
--
--   dedupe  (upsertVenue, runs on EVERY match creation)
--       WHERE name ILIKE 'Wankhede Stadium'
--     A btree on lower(name) CANNOT serve this. ILIKE is not rewritten to
--     lower(name) = lower($1) by the planner. So the query has to change too.
--
--   search  (venues directory)
--       WHERE name ILIKE '%wankhede%'
--     No btree can serve a LEADING wildcard, whatever the expression. Only a
--     trigram index can.
--
-- Hence: one new function (so the dedupe can be expressed as an equality the
-- index matches), one trigram index, one functional btree, one listing index.

-- ── 1 · trigram support for the directory's %q% search ──────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_venues_name_trgm
  ON venues USING gin (name gin_trgm_ops);

-- ── 2 · the dedupe path ─────────────────────────────────────────────────────
-- The functional index the rewritten lookup can actually use.
CREATE INDEX IF NOT EXISTS idx_venues_lower_name
  ON venues (lower(name));

-- PostgREST can't express `lower(name) = lower($1)` on the left-hand side, so
-- the equality lives here as a function the API calls instead of a filter.
--
-- Semantics are a DELIBERATE copy of the code being replaced, so nothing about
-- matching changes: case-insensitive exact match on the trimmed name, and the
-- city filter applies ONLY when a city is supplied (a null city matches any
-- row, exactly as `if (cityId) query.eq(...)` did).
CREATE OR REPLACE FUNCTION venue_find_exact(p_name text, p_city_id uuid DEFAULT NULL)
RETURNS SETOF venues
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM venues
  WHERE lower(name) = lower(btrim(p_name))
    AND (p_city_id IS NULL OR city_id = p_city_id)
  LIMIT 1;
$$;

-- ── 3 · the listing order ───────────────────────────────────────────────────
-- searchVenues with a city filter: WHERE city_id = $1 ORDER BY use_count DESC.
CREATE INDEX IF NOT EXISTS idx_venues_city_use_count
  ON venues (city_id, use_count DESC);

COMMENT ON FUNCTION venue_find_exact(text, uuid) IS
  'SC-369: case-insensitive exact venue lookup for the upsert dedupe. Exists so the query is an equality that idx_venues_lower_name can serve — PostgREST cannot express lower(name) = lower($1) as a filter.';
