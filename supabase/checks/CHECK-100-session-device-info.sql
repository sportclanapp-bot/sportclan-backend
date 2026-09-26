-- ===========================================================================
-- CHECK-100 · after migration 100. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the columns and their types.
-- Expected 4 rows, all nullable: app_version text, device_name text,
-- device_os text, last_used_at timestamp with time zone.
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
  AND column_name IN ('device_name', 'device_os', 'app_version', 'last_used_at')
ORDER BY column_name;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · READ-ONLY · after BE-2 is deployed and someone signs in: the
-- newest sessions carry their device. Expected: the latest rows show a device
-- name, OS and app version (older rows stay NULL until they sign in again).
-- ---------------------------------------------------------------------------
SELECT created_at, device_name, device_os, app_version, last_used_at, revoked
FROM refresh_tokens
ORDER BY created_at DESC
LIMIT 5;
