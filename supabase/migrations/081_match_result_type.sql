-- SC-373 · make a DRAW a first-class recordable result.
--
-- THE PROBLEM: completeMatch protected against completing a match that was never
-- played (SC-42) by requiring an explicit `winner_team_id` on a still-scheduled
-- match with no scoring events. That used "has a winner" as a proxy for "a
-- result was actually recorded" — which silently made a legitimate DRAW
-- indistinguishable from an unplayed fixture, so drawn results could not be
-- entered at all without first faking the match into 'live'.
--
-- THE FIX: record HOW a match was decided, so "draw" and "never played" are
-- different facts rather than both being "no winner". The guard then keys on
-- the presence of a recorded result, not on the presence of a winner.
--
-- Nullable with no default and no backfill: existing rows keep NULL, which
-- means "not recorded through this path" and changes nothing about how they
-- already read. Every consumer treats NULL exactly as it does today.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS result_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'matches'::regclass AND conname = 'matches_result_type_check'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT matches_result_type_check
      CHECK (result_type IS NULL OR result_type IN ('decisive', 'draw', 'walkover'));
  END IF;
END $$;

COMMENT ON COLUMN matches.result_type IS
  'SC-373: how a completed match was decided — decisive | draw | walkover. NULL for rows completed before this column existed. Exists so a recorded DRAW is distinguishable from a match that was never played, which winner_team_id IS NULL alone cannot express.';
