-- ===========================================================================
-- 111 · APPLIED by Dipak 29 Sep 2026 · "Prefer not to say" is its own gender
--
-- Decision item 22 (phase3/DECISIONS.md). users_gender_check allowed only
-- male / female / other, so Edit profile's "Prefer not to say" had to save
-- NULL and could never show as chosen. This re-adds the rule with a fourth
-- value. The backend's allowed list (utils/profileRules GENDERS) matches it.
--
-- Recorded in FIX_PLAN.md: block 1 showed the old rule; block 2 returned
-- "Success. No rows returned"; block 3 showed the four values. No row changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the rule as it was.
-- Expected: users_gender_check | CHECK ((gender = ANY (ARRAY['male'::text,
-- 'female'::text, 'other'::text])))
-- ---------------------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass AND pg_get_constraintdef(oid) ILIKE '%gender%';


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · drop and re-add the rule with 4 values.
-- Every existing value is one of the first three (or NULL), so it validates.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT users_gender_check;
ALTER TABLE public.users ADD CONSTRAINT users_gender_check
  CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify.
-- Expected: users_gender_check | CHECK ((gender = ANY (ARRAY['male'::text,
-- 'female'::text, 'other'::text, 'prefer_not_to_say'::text])))
-- ---------------------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass AND pg_get_constraintdef(oid) ILIKE '%gender%';
