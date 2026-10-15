-- ===========================================================================
-- 158 · APPLY · a team can be reported, and a moderator can remove it
-- (N-RWG2-9, launch test plan Round 4)
--
-- A team with an offensive name or logo could not be reported:
-- content_reports.target_type allowed post / comment / user / message /
-- profile_post / profile_comment only. And admins had no way to remove a team.
-- Now:
--   • content_reports.target_type also accepts 'team'
--   • teams.deleted_reason also accepts 'moderator' (a moderator's removal is
--     the same soft mark as a captain's disband — migration 106 — the row,
--     its former members and its expenses all stay, and it can be restored)
--
-- The backend that writes these values must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only. No row is changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the two check rules as they are today.
-- Expected: report_types lists post, comment, user, message, profile_post,
-- profile_comment; team_reasons lists captain_disband, last_member_left.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%target_type%')          AS report_types,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'teams_deleted_reason_check')                   AS team_reasons;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · widen the two check rules. Idempotent.
-- Both are replaced in one transaction; no row is read, changed or removed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE content_reports DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check
    CHECK (target_type IN ('post', 'comment', 'user', 'message', 'profile_post', 'profile_comment', 'team'));

  ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_deleted_reason_check;
  ALTER TABLE teams ADD CONSTRAINT teams_deleted_reason_check
    CHECK (deleted_reason IS NULL OR deleted_reason IN ('captain_disband', 'last_member_left', 'moderator'));
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: report_types also lists team; team_reasons also lists moderator.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%target_type%')          AS report_types,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'teams_deleted_reason_check')                   AS team_reasons;
