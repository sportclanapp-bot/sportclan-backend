-- 069: play-invite 48h auto-expiry (SC-332).
--
-- Adds 'expired' to the invites.status domain. The original constraint (mig 003)
-- was an inline column check → Postgres auto-named it (typically
-- `invites_status_check`), but we drop it by discovered name so this is robust
-- regardless of the exact identifier (SC-116: column/constraint-verify before DDL).
--
-- Correctness of expiry does NOT depend on this status ever being written — every
-- read + the dedup guard treat a >48h-old PENDING row as expired via created_at.
-- This value + the hygiene sweep (POST /jobs/expire-invites) just make the stored
-- status honest once CRON_SECRET is set.

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'invites'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invites DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE invites
  ADD CONSTRAINT invites_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired'));

-- Speeds up the freshness filter (reads) + the hygiene sweep: only pending rows,
-- ordered by age.
CREATE INDEX IF NOT EXISTS idx_invites_pending_created
  ON invites (created_at)
  WHERE status = 'pending';
