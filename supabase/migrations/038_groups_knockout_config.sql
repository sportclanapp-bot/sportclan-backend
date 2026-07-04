-- 038 · groups_knockout configuration (SC-58)
--
-- The groups→knockout format previously hardcoded 4 teams per group and top-2
-- qualifiers, which (a) made common formats impossible (top-1-per-group cup,
-- organizer-chosen group size/count) and (b) forced index-seeded byes. These
-- columns let the organizer configure the group stage; the controller reads
-- them defensively and falls back to the historical 4/derived/top-2 defaults
-- when they are absent, so deploying the code before this migration is safe.
--
-- All ADD COLUMN IF NOT EXISTS — idempotent, safe to re-run.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS num_groups INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS group_size INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS qualifiers_per_group INTEGER NOT NULL DEFAULT 2;
