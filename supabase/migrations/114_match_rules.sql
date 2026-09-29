-- 114 · match rules as data (BUILD 2.1 and 2.4).
--
-- matches.rules      the rules a match is played to, as one versioned JSON
--                    object ({"v":1, ...}) — overs, best-of, points per game,
--                    time control and the rest, per sport. `format` / `overs`
--                    stay as they are: older apps read them, and they're kept
--                    in step for display.
-- tournaments.match_rules
--                    the organiser's rules per stage (group / knockout /
--                    final), copied onto each fixture's `rules` at the draw.
--
-- Both nullable with no default: existing rows stay NULL and mean "the
-- sport's standard rules", exactly as today. Adding a nullable column with no
-- default doesn't rewrite the table. No data change.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rules jsonb;
ALTER TABLE matches ADD CONSTRAINT matches_rules_is_object
  CHECK (rules IS NULL OR jsonb_typeof(rules) = 'object');

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS match_rules jsonb;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_match_rules_is_object
  CHECK (match_rules IS NULL OR jsonb_typeof(match_rules) = 'object');

NOTIFY pgrst, 'reload schema';
