-- ============================================================================
-- SportClan · cricket tournament gaps 1, 2, 3, 5, 6, 9, 10 + migration 117
-- One batch in three parts. Run part A, then B, then C, in the Supabase SQL editor.
-- Prepared 5 Oct 2026. Nothing here has been run.
--
-- What changes (and nothing else):
--   117  sports.display_order        → the app's one sport order (Cricket first)
--   118  matches.scorer_id            → an organiser can name a scorer per fixture (gap 3)
--   119  tournament_entries.fee_*     → organiser-only paid/unpaid tracking (gap 10)
-- Gaps 1, 2, 5, 6 and 9 need no schema change. They use existing columns:
-- tournaments.match_rules, matches.rules, innings_stats, matches.score_summary,
-- matches.result_type 'walkover', tournaments.settings and match_events.payload.
-- Every change adds a column or index, nullable or with a default, so older apps
-- keep working.
-- ============================================================================


-- ============================================================================
-- PART A · READ-ONLY CHECK (run first; changes nothing)
-- ============================================================================

-- A1 · sports in display_order today (expect Cricket, Football, Basketball, …)
SELECT slug, display_order, is_active FROM sports ORDER BY display_order;

-- A2 · the new columns must NOT exist yet (expect 0 rows)
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'matches' AND column_name = 'scorer_id')
    OR (table_name = 'tournament_entries' AND column_name IN ('fee_paid_at', 'fee_marked_by', 'fee_note')));

-- A3 · what they depend on exists (expect 3 rows: matches.umpire_id, users.id, tournament_entries.id)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'matches' AND column_name = 'umpire_id')
    OR (table_name = 'users' AND column_name = 'id')
    OR (table_name = 'tournament_entries' AND column_name = 'id'));

-- A4 · walkover is already an allowed result_type (expect the constraint to list 'walkover')
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'matches'::regclass AND conname = 'matches_result_type_check';

-- A5 · row counts for the record (part B rewrites only the sports rows)
SELECT (SELECT count(*) FROM sports) AS sports,
       (SELECT count(*) FROM matches) AS matches,
       (SELECT count(*) FROM tournament_entries) AS entries;


-- ============================================================================
-- PART B · CHANGES DATA (one transaction: all or nothing)
-- ============================================================================
BEGIN;

-- 117 · sports.display_order in the app's one order. Kabaddi/Athletics (inactive) last.
UPDATE sports SET display_order = CASE slug
  WHEN 'cricket'      THEN 1
  WHEN 'badminton'    THEN 2
  WHEN 'football'     THEN 3
  WHEN 'tennis'       THEN 4
  WHEN 'table-tennis' THEN 5
  WHEN 'pickleball'   THEN 6
  WHEN 'chess'        THEN 7
  WHEN 'carrom'       THEN 8
  WHEN 'volleyball'   THEN 9
  WHEN 'basketball'   THEN 10
  WHEN 'hockey'       THEN 11
  WHEN 'kabaddi'      THEN 12
  WHEN 'athletics'    THEN 13
  ELSE display_order
END;

-- 118 · a scorer named for one fixture (gap 3). The umpire already has matches.umpire_id.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS scorer_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_matches_scorer ON matches (scorer_id) WHERE scorer_id IS NOT NULL;
COMMENT ON COLUMN matches.scorer_id IS
  'Gap 3 (5 Oct 2026): the scorer the organiser named for this fixture. May score it like an organiser. NULL = none named.';

-- 119 · entry fee paid/unpaid, kept by the organiser only (gap 10). No money moves through the app.
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS fee_paid_at   timestamptz,
  ADD COLUMN IF NOT EXISTS fee_marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fee_note      text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'tournament_entries'::regclass AND conname = 'tournament_entries_fee_note_len') THEN
    ALTER TABLE tournament_entries
      ADD CONSTRAINT tournament_entries_fee_note_len CHECK (fee_note IS NULL OR char_length(fee_note) <= 120);
  END IF;
END $$;
COMMENT ON COLUMN tournament_entries.fee_paid_at IS
  'Gap 10 (5 Oct 2026): when the organiser marked this entry''s fee paid (cash/UPI outside the app). NULL = unpaid. Shown to organisers only.';

COMMIT;


-- ============================================================================
-- PART C · READ-ONLY VERIFY (run after B; changes nothing)
-- ============================================================================

-- C1 · sports now in the app's order (expect cricket 1 … hockey 11, kabaddi 12, athletics 13)
SELECT slug, display_order, is_active FROM sports ORDER BY display_order;

-- C2 · the four new columns exist (expect 4 rows)
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'matches' AND column_name = 'scorer_id')
    OR (table_name = 'tournament_entries' AND column_name IN ('fee_paid_at', 'fee_marked_by', 'fee_note')))
ORDER BY table_name, column_name;

-- C3 · index and constraint in place (expect 2 rows)
SELECT 'index' AS kind, indexname AS name FROM pg_indexes WHERE indexname = 'idx_matches_scorer'
UNION ALL
SELECT 'constraint', conname FROM pg_constraint WHERE conname = 'tournament_entries_fee_note_len';

-- C4 · nothing existing was touched (expect 0 and 0)
SELECT (SELECT count(*) FROM matches WHERE scorer_id IS NOT NULL) AS scorers_set,
       (SELECT count(*) FROM tournament_entries WHERE fee_paid_at IS NOT NULL OR fee_note IS NOT NULL) AS fees_set;
