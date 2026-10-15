-- ===========================================================================
-- 160 · F194 (launch test plan, Round 4, 16 Oct 2026) · city-less venues get
-- their creator's city
--
-- New match never sent a city, so every venue typed there was saved with none
-- (25 of the 26 local venues) and never showed under Venues "In <your city>".
-- The server now saves such a venue with the match's city, or its creator's
-- (venueCityFor), and a later match that names a city-less venue gives it the
-- city then (adoptCitylessVenue). This fills in the venues already saved the
-- same way: a live venue with no city takes its creator's city.
--
-- Only city_id, and only where it is empty: no row is removed, no other column
-- changes. Skipped: deleted venues, venues with no creator or whose creator has
-- no city, and a name that already has a live venue in that city (it would be
-- a second copy the "Add venue" upsert could never tell apart). When several
-- city-less venues share a name and would land in the same city, only the most
-- used one takes it. Safe to run twice: a second run changes 0 rows.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · how many venues block 2 will change.
-- ---------------------------------------------------------------------------
SELECT count(*) AS venues_to_fill
FROM public.venues v
JOIN public.users u ON u.id = v.created_by
WHERE v.city_id IS NULL AND v.deleted_at IS NULL AND u.city_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · WRITE · fill the city where it is empty.
-- ---------------------------------------------------------------------------
WITH candidates AS (
  SELECT DISTINCT ON (lower(v.name), u.city_id) v.id, u.city_id
  FROM public.venues v
  JOIN public.users u ON u.id = v.created_by
  WHERE v.city_id IS NULL
    AND v.deleted_at IS NULL
    AND u.city_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.venues o
      WHERE o.city_id = u.city_id AND lower(o.name) = lower(v.name) AND o.deleted_at IS NULL
    )
  ORDER BY lower(v.name), u.city_id, v.use_count DESC NULLS LAST, v.created_at ASC NULLS LAST, v.id
)
UPDATE public.venues v
SET city_id = c.city_id
FROM candidates c
WHERE v.id = c.id AND v.city_id IS NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · live venues, with and without a city, after.
-- ---------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE city_id IS NOT NULL) AS with_city,
       count(*) FILTER (WHERE city_id IS NULL) AS without_city
FROM public.venues
WHERE deleted_at IS NULL;
