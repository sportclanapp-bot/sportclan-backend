-- ============================================================================
-- SportClan · badminton tournament gaps (BADMINTON_TOURNAMENT_JOURNEY.md)
-- One batch in three parts. Run A, then B, then C, in the Supabase SQL editor.
-- Each of A and C is ONE read-only query that returns ONE row.
-- Prepared Oct 2026. Nothing here has been run.
--
-- What changes (and nothing else):
--   120  tournaments.parent_id / is_parent / entry_kind / event_label / event_order
--        → events inside a tournament (gap 1); singles / doubles events (gap 2)
--   121  teams.kind ('club' | 'entry') + table tournament_pair_invites
--        → enter as yourself or as a pair, with the partner's acceptance (gap 2)
--   122  matches.result_type gains 'retired'; matches.called_at / called_by
--        → retirement (gap 6); court call-ups (gap 5)
-- Every other item needs no schema change (it uses tournaments.settings,
-- tournaments.match_rules, matches.score_summary, matches.ground_label and
-- match_events.payload).
-- Every change adds a column with a default or NULL, a new table, or a wider
-- CHECK. Existing rows get: is_parent false, entry_kind 'team', kind 'club'.
-- So every existing tournament, team and match stays exactly as it is, and
-- older apps keep working.
-- ============================================================================


-- ============================================================================
-- PART A · READ-ONLY CHECK (one row; changes nothing)
-- Expect: new_columns_present 0 · invites_table_absent true ·
--         needed_columns 17 · result_type_check lists decisive, draw, walkover ·
--         new_constraints_present 0 · new_indexes_present 0
-- ============================================================================
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'tournaments' AND column_name IN ('parent_id', 'is_parent', 'entry_kind', 'event_label', 'event_order'))
        OR (table_name = 'teams' AND column_name = 'kind')
        OR (table_name = 'matches' AND column_name IN ('called_at', 'called_by'))))         AS new_columns_present,
  (to_regclass('public.tournament_pair_invites') IS NULL)                                  AS invites_table_absent,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'tournaments'        AND column_name IN ('id', 'settings', 'match_rules', 'fixtures_generated'))
        OR (table_name = 'teams'              AND column_name IN ('id', 'created_by'))
        OR (table_name = 'team_members'       AND column_name IN ('team_id', 'user_id', 'role'))
        OR (table_name = 'tournament_entries' AND column_name IN ('id', 'team_id'))
        OR (table_name = 'matches'            AND column_name IN ('result_type', 'ground_label', 'scheduled_at'))
        OR (table_name = 'users'              AND column_name IN ('id', 'gender', 'dob'))))      AS needed_columns,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass AND conname = 'matches_result_type_check')     AS result_type_check,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('tournaments_entry_kind_check', 'tournaments_event_shape_check',
                      'tournaments_event_label_len', 'tournaments_event_order_range', 'teams_kind_check')) AS new_constraints_present,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_tournaments_parent', 'idx_pair_invites_invitee',
                        'idx_pair_invites_tournament', 'uq_pair_invites_live'))              AS new_indexes_present;


-- ============================================================================
-- PART B · CHANGES DATA (one transaction: all or nothing)
-- ============================================================================
BEGIN;

-- 120 · events inside a tournament (gap 1) and singles / doubles events (gap 2)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_parent   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entry_kind  text    NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS event_label text,
  ADD COLUMN IF NOT EXISTS event_order smallint;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_entry_kind_check
  CHECK (entry_kind IN ('team', 'singles', 'doubles'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_shape_check
  CHECK (parent_id IS NULL OR (NOT is_parent AND parent_id <> id));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_label_len
  CHECK (event_label IS NULL OR char_length(event_label) BETWEEN 1 AND 60);
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_order_range
  CHECK (event_order IS NULL OR event_order BETWEEN 0 AND 99);
CREATE INDEX IF NOT EXISTS idx_tournaments_parent
  ON tournaments (parent_id, event_order) WHERE parent_id IS NOT NULL;
COMMENT ON COLUMN tournaments.parent_id IS
  'Badminton gap 1: set on an event (Men''s singles, U-15 doubles …) to the tournament it belongs to. NULL = a tournament.';
COMMENT ON COLUMN tournaments.is_parent IS
  'Badminton gap 1: true on a tournament made of events. Its own entries and fixtures stay empty; the events hold them.';
COMMENT ON COLUMN tournaments.entry_kind IS
  'Badminton gap 2: who enters — team (as today), singles (one player) or doubles (a pair). Existing rows: team.';

-- 121 · enter as yourself or as a pair (gap 2)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'club';
ALTER TABLE teams ADD CONSTRAINT teams_kind_check CHECK (kind IN ('club', 'entry'));
COMMENT ON COLUMN teams.kind IS
  'Badminton gap 2: club = a team people make (as today); entry = made by the server for one singles or doubles entry, hidden from team lists.';

CREATE TABLE IF NOT EXISTS tournament_pair_invites (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  inviter_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id    uuid        REFERENCES users(id) ON DELETE CASCADE,
  entry_id      uuid        REFERENCES tournament_entries(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT tournament_pair_invites_status_check
    CHECK (status IN ('open', 'pending', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT tournament_pair_invites_note_len
    CHECK (note IS NULL OR char_length(note) <= 120),
  CONSTRAINT tournament_pair_invites_not_self
    CHECK (invitee_id IS NULL OR invitee_id <> inviter_id),
  CONSTRAINT tournament_pair_invites_open_shape
    CHECK (status <> 'open' OR invitee_id IS NULL),
  CONSTRAINT tournament_pair_invites_invitee_shape
    CHECK (status NOT IN ('pending', 'accepted', 'declined') OR invitee_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pair_invites_invitee
  ON tournament_pair_invites (invitee_id, status) WHERE invitee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pair_invites_tournament
  ON tournament_pair_invites (tournament_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pair_invites_live
  ON tournament_pair_invites (tournament_id, inviter_id) WHERE status IN ('open', 'pending');
ALTER TABLE tournament_pair_invites ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE tournament_pair_invites IS
  'Badminton gap 2: a doubles partner request. pending = invited, waiting; open = looking for a partner; accepted makes (or, with entry_id, changes) the pair''s entry. Service-role only.';

-- 122 · retirement (gap 6) and court call-ups (gap 5)
ALTER TABLE matches DROP CONSTRAINT matches_result_type_check;
ALTER TABLE matches ADD CONSTRAINT matches_result_type_check
  CHECK (result_type IS NULL OR result_type IN ('decisive', 'draw', 'walkover', 'retired'));
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS called_by uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN matches.called_at IS
  'Badminton gap 5: when the desk called this fixture to its court (matches.ground_label). NULL = not called.';

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================================
-- PART C · READ-ONLY VERIFY (one row; run after B; changes nothing)
-- Expect: new_columns 8 · invite_columns 9 · new_constraints 10 · new_indexes 4 ·
--         invites_rls_on true · retired_allowed true · team_kind_default 'club'::text ·
--         existing_rows_changed 0
-- ============================================================================
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'tournaments' AND column_name IN ('parent_id', 'is_parent', 'entry_kind', 'event_label', 'event_order'))
        OR (table_name = 'teams' AND column_name = 'kind')
        OR (table_name = 'matches' AND column_name IN ('called_at', 'called_by'))))         AS new_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_pair_invites')              AS invite_columns,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('tournaments_entry_kind_check', 'tournaments_event_shape_check',
                      'tournaments_event_label_len', 'tournaments_event_order_range', 'teams_kind_check',
                      'tournament_pair_invites_status_check', 'tournament_pair_invites_note_len',
                      'tournament_pair_invites_not_self', 'tournament_pair_invites_open_shape',
                      'tournament_pair_invites_invitee_shape'))                            AS new_constraints,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_tournaments_parent', 'idx_pair_invites_invitee',
                        'idx_pair_invites_tournament', 'uq_pair_invites_live'))              AS new_indexes,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tournament_pair_invites'::regclass) AS invites_rls_on,
  (SELECT pg_get_constraintdef(oid) LIKE '%retired%' FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass AND conname = 'matches_result_type_check')   AS retired_allowed,
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'kind')       AS team_kind_default,
  ((SELECT count(*) FROM tournaments WHERE parent_id IS NOT NULL OR is_parent OR entry_kind <> 'team')
   + (SELECT count(*) FROM teams WHERE kind <> 'club')
   + (SELECT count(*) FROM matches WHERE called_at IS NOT NULL))                            AS existing_rows_changed;
