-- 167 · Q43 (Step 3, Dipak chose B, 21 Nov 2026): when a tournament's creator deletes their account,
-- the longest-standing co-organiser takes it over; with no co-organiser the app admin decides, so the
-- tournament goes into the admin queue (Admin › Reports): content_reports.target_type also accepts
-- 'tournament'. Only the check rule is widened; no row is read, changed or removed. Safe to run twice.
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
    CHECK (target_type IN ('post', 'comment', 'user', 'message', 'profile_post', 'profile_comment', 'team', 'tournament'));
END $$;
