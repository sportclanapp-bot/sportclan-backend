-- 116 · tournament-wide settings (BUILD Stage 4).
--
-- tournaments.settings      the organiser's tournament-wide options as one
--                           versioned JSON object ({"v":1, ...}): points
--                           template, best third places, seeding mode,
--                           walkover score, minimum rest, open entry vs
--                           approval, third-place match, same-club separation,
--                           category, Swiss rounds and byes. NULL means
--                           "today's behaviour" for every option.
-- tournament_entries.club   the club / state / institution an entry plays for,
--                           so the draw can keep same-club entries apart
--                           (the Indian Carrom Federation separates by state).
-- matches.third_place       true on a knockout's third-place match — the one
--                           match with no next match that isn't the final.
-- tournaments.format        gains 'swiss' (chess).
--
-- All new columns nullable with no default: existing rows stay NULL, nothing
-- is rewritten, older apps and the current server are unaffected. The format
-- CHECK is replaced by the same list plus 'swiss'. No data change.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS settings jsonb;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_settings_is_object
  CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object');

ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS club text;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_club_length
  CHECK (club IS NULL OR char_length(club) BETWEEN 1 AND 60);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS third_place boolean;

ALTER TABLE tournaments DROP CONSTRAINT tournaments_format_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('knockout', 'league', 'round_robin', 'groups_knockout', 'swiss'));

NOTIFY pgrst, 'reload schema';
