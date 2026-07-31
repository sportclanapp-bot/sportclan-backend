-- SC-386 PART 1 · STEP 2 of 2 — the data migration.
--
-- ONLY run this after AUDIT-sc386-phone-forms.sql query 3 returns ZERO rows.
-- If there are collisions, two real accounts share one number and picking a
-- survivor is a product decision, not something a migration may do silently.
-- The guard below enforces that: the migration ABORTS rather than merging.
--
-- WHY E.164 (+91XXXXXXXXXX): it is what registration already produces, what the
-- login screen sends, and the only form that is unambiguous. Everything else in
-- the table is a variant of it.
--
-- IDEMPOTENT: rows already canonical are left alone, so re-running is a no-op.
-- NOBODY IS STRANDED: a value that cannot be canonicalised (not a valid Indian
-- mobile) is deliberately LEFT AS IT IS. Rewriting it to NULL or to a guess
-- would lock that account out; the login lookup stays permissive so it keeps
-- working exactly as it does today.

BEGIN;

CREATE OR REPLACE FUNCTION sc386_canon(p text) RETURNS text AS $$
DECLARE d text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  d := regexp_replace(d, '^0+', '');
  IF length(d) = 12 AND left(d, 2) = '91' THEN d := right(d, 10); END IF;
  IF length(d) = 10 AND left(d, 1) ~ '[6-9]' THEN RETURN '+91' || d; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

-- Refuse to run if canonicalising would collapse two accounts into one.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT sc386_canon(phone)
    FROM users
    WHERE phone IS NOT NULL AND sc386_canon(phone) IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) c;
  IF n > 0 THEN
    RAISE EXCEPTION
      'SC-386 ABORT: % canonical number(s) map to more than one account. Run AUDIT-sc386-phone-forms.sql query 3 and decide per collision before migrating.', n;
  END IF;
END $$;

-- Rewrite only the rows that are not already canonical AND can be.
UPDATE users
SET phone = sc386_canon(phone)
WHERE phone IS NOT NULL
  AND sc386_canon(phone) IS NOT NULL
  AND phone <> sc386_canon(phone);

-- Uniqueness on the canonical value. Safe to add only because the guard above
-- proved there are no duplicates. Partial: rows whose phone could not be
-- canonicalised (and NULLs) are excluded rather than blocked.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_canonical_key
  ON users (phone)
  WHERE phone ~ '^\+91[6-9][0-9]{9}$';

DROP FUNCTION IF EXISTS sc386_canon(text);

COMMIT;
