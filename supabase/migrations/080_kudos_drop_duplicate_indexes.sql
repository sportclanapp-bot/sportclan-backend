-- SC-369 · remove the duplicate unique indexes on kudos.
--
-- Prod carries the same guarantee up to three times over
-- (from_user_id, to_user_id, match_id):
--   kudos_from_user_id_to_user_id_match_id_key  -- backed by the inline UNIQUE constraint
--   uq_kudos_triple                             -- standalone unique index
--   uq_kudos_from_to_match                      -- standalone, created by migration 048
--
-- Every duplicate costs an extra index write on each kudos insert and extra
-- storage, and protects nothing the constraint doesn't already protect.
--
-- WHICH ONE SURVIVES: the CONSTRAINT-backed index. Dropping that one would mean
-- ALTER TABLE ... DROP CONSTRAINT, which removes the uniqueness rule itself —
-- even if re-added a moment later, there is a window with no guarantee. Dropping
-- the standalone indexes leaves the constraint (and therefore the guarantee)
-- untouched at every instant.
--
-- Idempotent: DROP INDEX IF EXISTS, and safe on a database where 048 has been
-- amended so uq_kudos_from_to_match was never created.

DROP INDEX IF EXISTS uq_kudos_triple;
DROP INDEX IF EXISTS uq_kudos_from_to_match;

-- Assert the guarantee survived. If some environment lost the constraint, fail
-- loudly here rather than leaving kudos silently un-deduplicated.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint
  WHERE conrelid = 'kudos'::regclass
    AND contype = 'u';

  IF n = 0 THEN
    RAISE EXCEPTION
      'kudos has no UNIQUE constraint left after dropping duplicates — refusing to leave it unprotected';
  END IF;

  RAISE NOTICE 'kudos uniqueness intact: % unique constraint(s) remain', n;
END $$;
