-- 044: ensure public.users.deleted_at exists (SC-69 — account deletion 500).
--
-- POST /account/delete soft-deletes by writing users.deleted_at (+ scrubbing
-- PII). In prod that column was MISSING — migration 006 added it inside a
-- conditional DO block that never took effect on this database, so the UPDATE
-- errored ("column does not exist"), surfaced as a generic 500 by the error
-- sanitizer, and the GDPR / app-store account-deletion flow was fully broken
-- (500 + zero write). The deleteAccount code was correct all along; it just
-- needed the column. Confirmed absent via information_schema (scoped to the
-- public schema — auth.users has its own deleted_at, which had masked the gap).
--
-- Fully schema-qualified as public.users on purpose: this bug originated from
-- the auth.users / public.users name collision, so we leave zero search_path
-- ambiguity. Idempotent — safe to re-run.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Keep the daily purge cron (WHERE deleted_at < cutoff AND deleted_at IS NOT
-- NULL) cheap on a large users table without indexing live (NULL) rows.
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users (deleted_at) WHERE deleted_at IS NOT NULL;
