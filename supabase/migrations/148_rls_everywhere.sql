-- 148 · Audit #17 (11 Oct 2026, Dipak's decision 6): row-level security on
-- EVERY table. How the database is reached (mapped 11 Oct): the backend only,
-- with the service-role key (service_role has BYPASSRLS, so it works exactly as
-- before); the app never talks to the database (it holds no key). So the
-- public keys (anon, authenticated) get no policy and no grant anywhere: with
-- the anon key you can read or write nothing. Safe to run twice; covers tables
-- made outside migrations (the dashboard) because it walks the catalogue.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END
$$;

DO $$
DECLARE r record; pub_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO pub_roles
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  IF pub_roles IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ' || pub_roles;
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ' || pub_roles;
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, ' || pub_roles;
    -- Tables, sequences and functions made later don't get them either.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ' || pub_roles;
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ' || pub_roles;
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ' || pub_roles;
  ELSE
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC';
  END IF;
  -- The server keeps everything it had.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
  END IF;
  -- A view runs with its owner's rights by default, which would step around
  -- RLS; make every view check the caller instead (Postgres 15+).
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', r.viewname);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'view % left as is: %', r.viewname, SQLERRM;
    END;
  END LOOP;
END
$$;
