-- ===========================================================================
-- 100 · APPLY · sessions you can tell apart (visual review B15 · V072, D17)
--
-- THE BUG. Settings › Active sessions listed every sign-in as "Mobile device ·
-- 26m" — no phone, no OS, no app version — so nobody could tell which one to
-- sign out. getSessions already asks for device columns and silently falls
-- back when they are missing, which they are.
--
-- THE FIX. Four nullable columns on refresh_tokens. The backend deployed with
-- this (BE-2) fills the first three at sign-in (from headers the app sends)
-- and last_used_at on every token refresh. No default → no table rewrite;
-- existing sessions read as "unknown device" until they sign in again.
--
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · count first, and which columns already exist.
-- Expected: sessions = (current count); present = the list of these columns
-- that already exist (expected: none).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM refresh_tokens) AS sessions,
  (SELECT string_agg(column_name, ', ' ORDER BY column_name) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
      AND column_name IN ('device_name', 'device_os', 'app_version', 'last_used_at')) AS present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · the four columns. Idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_name  text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_os    text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS app_version  text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify. Expected: new_columns = 4, sessions unchanged
-- from block 1, with_device = 0 (nothing is filled in by the migration).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
      AND column_name IN ('device_name', 'device_os', 'app_version', 'last_used_at')) AS new_columns,
  (SELECT count(*) FROM refresh_tokens) AS sessions,
  (SELECT count(*) FROM refresh_tokens WHERE device_name IS NOT NULL OR last_used_at IS NOT NULL) AS with_device;
