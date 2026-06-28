-- Migration 029 · Admin user-management: account suspension
--
-- Adds a nullable suspension timestamp on users. NULL = active;
-- a timestamp = suspended (set/cleared by admins via PATCH /admin/users/:id).
-- Enforced at login (otpLogin rejects suspended accounts). Additive + idempotent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_suspended
  ON users(suspended_at)
  WHERE suspended_at IS NOT NULL;
