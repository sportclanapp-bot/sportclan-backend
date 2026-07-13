-- 058 · SC-209 — allow reporting a message/DM.
--
-- content_reports.target_type was CHECK (target_type IN ('post','comment','user'))
-- (mig 027), so inserting a 'message' report fails the constraint. Widen the
-- CHECK to include 'message'. Existing rows are all in the old set, so the new
-- constraint validates cleanly.
--
-- Constraint name is auto-generated; drop by discovering it, then re-add. We do
-- it via a DO block so this is safe whatever the generated name is.

DO $$
DECLARE
  c_name text;
BEGIN
  SELECT con.conname INTO c_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'content_reports'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%target_type%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE content_reports DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE content_reports
  ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'user', 'message'));
