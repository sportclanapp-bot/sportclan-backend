-- 153 · Profile & Settings tidy-up (12 Oct 2026): the sender's "Sent" invites
-- show each invite's status, a withdrawn one too. Withdrawing used to delete the
-- row (archived in deleted_records), so "withdrawn" could never be shown. Adds
-- 'withdrawn' to invites.status; the withdraw endpoint now sets it (the receiver's
-- list leaves withdrawn invites out, as before). Additive; safe to run twice.
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'invites'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE invites DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE invites
  ADD CONSTRAINT invites_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn'));
