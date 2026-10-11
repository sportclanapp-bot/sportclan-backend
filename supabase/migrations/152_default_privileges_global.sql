-- 152 · Block 148 follow-up (12 Oct 2026, diagnosed on live with LIVE_SQL_DIAG_148.sql).
-- 148 took the public keys' (anon, authenticated) default privileges away INSIDE schema public. But
-- Postgres gives every new function EXECUTE to PUBLIC by a built-in default, and a per-schema default can
-- only add to that, never take it away — so a function made by a later migration could still be run with
-- the anon key unless that migration revoked it by hand (150 and 151 do). Taken away here globally, for
-- the role that runs the migrations (postgres). The server (service_role) keeps EXECUTE on new functions
-- in public through 148's per-schema grant. Safe to run twice.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $$
DECLARE pub_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO pub_roles FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  IF pub_roles IS NOT NULL THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM ' || pub_roles;
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM ' || pub_roles;
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ' || pub_roles;
  END IF;
END
$$;
