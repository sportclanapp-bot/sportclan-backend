-- 070: deactivate out-of-scope sports (SC-335) — Kabaddi + Athletics.
--
-- Launch scope is 11 sports; prod had 13 and both extras were scoreable. This adds
-- the single source of truth `sports.is_active` (default true) and flips the two
-- out-of-scope sports OFF. Their rows (and all their seed matches / profiles) are
-- KEPT — teardown removes those separately — this only takes them OUT OF SCOPE so
-- nothing user-facing lists / creates / scores them.
--
-- SC-116: `is_active` did not exist on sports (columns were id/name/slug/emoji/
-- color/display_order/created_at). ADD COLUMN IF NOT EXISTS + the slug-scoped UPDATE
-- are both idempotent and safe to re-run.

ALTER TABLE sports ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE sports SET is_active = false WHERE slug IN ('kabaddi', 'athletics');

-- Sanity (informational): the canonical 11 must remain active.
--   SELECT slug, is_active FROM sports ORDER BY display_order;
-- Expect is_active=false ONLY for kabaddi + athletics; the other 11 true.
