-- 154 · F027 (launch test plan, Round 1, 14 Oct 2026): a sign-in key the phone had
-- already replaced kept working for ever, and a copy of it signed the real owner out.
-- The key a lost-reply renewal pushes aside is kept here (by its SHA-256 hash). If it
-- is ever shown later, a second holder exists and the server ends that sign-in.
-- Rows go with their session (ON DELETE CASCADE). Server-only, like refresh_tokens:
-- RLS on, no policies. Additive, nothing existing changes. Safe to run twice.
CREATE TABLE IF NOT EXISTS refresh_token_orphans (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES refresh_tokens(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_token_orphans_session_idx ON refresh_token_orphans (session_id);
ALTER TABLE refresh_token_orphans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON refresh_token_orphans FROM PUBLIC;
DO $$
DECLARE pub_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO pub_roles FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  IF pub_roles IS NOT NULL THEN EXECUTE 'REVOKE ALL ON refresh_token_orphans FROM ' || pub_roles; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT ALL ON refresh_token_orphans TO service_role'; END IF;
END
$$;
