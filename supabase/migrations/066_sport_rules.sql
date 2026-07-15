-- 066_sport_rules.sql  (Z-5 / SC-267 per-sport rules)
-- Two per-sport capability columns on `sports`, exposed automatically by
-- GET /sports (which does select('*') — same mechanism as is_active). Single
-- source of truth; no BE/FE code map to drift. Apply BEFORE deploy: the
-- completeMatch tie guard reads allows_draw and the create form prefills from
-- default_duration_minutes.

-- allows_draw: can a completed match legitimately end level (no winner)?
--   TRUE  = cricket, chess, football, hockey (a draw/tie is a real result)
--   FALSE = badminton, table-tennis, pickleball, volleyball, tennis, carrom,
--           basketball (decisive sports — play on until there's a winner)
-- Default FALSE so a NEW/unmapped sport is treated as decisive; the guard fires
-- only on `allows_draw = false` (=== false), so it fails OPEN if the column were
-- ever absent (never wrongly blocks a legitimate tie).
ALTER TABLE sports ADD COLUMN IF NOT EXISTS allows_draw BOOLEAN NOT NULL DEFAULT false;

-- default_duration_minutes: prefill for the tournament scheduler's per-match
-- duration (organiser overrides freely). NULL = no prefill.
ALTER TABLE sports ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER;

-- Draw-capable sports (simple single-word slugs — no hyphen variants needed).
-- kabaddi is draw-capable if the row exists (currently inactive; harmless).
UPDATE sports SET allows_draw = true
  WHERE lower(slug) IN ('cricket', 'chess', 'football', 'hockey', 'kabaddi');

-- Duration prefills (wall-clock, amateur). Slug variants covered for hyphenated
-- names so table-tennis matches however it's stored.
UPDATE sports SET default_duration_minutes = 180 WHERE lower(slug) = 'cricket';
UPDATE sports SET default_duration_minutes = 90  WHERE lower(slug) = 'football';
UPDATE sports SET default_duration_minutes = 70  WHERE lower(slug) = 'hockey';
UPDATE sports SET default_duration_minutes = 90  WHERE lower(slug) = 'tennis';
UPDATE sports SET default_duration_minutes = 60  WHERE lower(slug) = 'basketball';
UPDATE sports SET default_duration_minutes = 45  WHERE lower(slug) = 'volleyball';
UPDATE sports SET default_duration_minutes = 30  WHERE lower(slug) = 'badminton';
UPDATE sports SET default_duration_minutes = 30  WHERE lower(slug) = 'pickleball';
UPDATE sports SET default_duration_minutes = 30  WHERE lower(slug) = 'carrom';
UPDATE sports SET default_duration_minutes = 20  WHERE lower(slug) IN ('table-tennis', 'tabletennis', 'table_tennis');
UPDATE sports SET default_duration_minutes = 60  WHERE lower(slug) = 'chess';

-- Verify:
SELECT slug, allows_draw, default_duration_minutes FROM sports ORDER BY display_order;
