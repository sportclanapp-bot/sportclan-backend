-- Part 3 Wave 2 — extend users table to match the OTP-only registration flow.
--
-- Why:
--   * Part 2 frontend collects username, gender, dob and link during sign-up,
--     but the original users table has no columns for them — those fields were
--     silently dropped by the register controller.
--   * Registration is OTP-based; password_hash should be optional so we don't
--     force every user to invent a password. Existing rows are unaffected.

alter table users
  add column if not exists username text,
  add column if not exists gender   text check (gender in ('male','female','other')),
  add column if not exists dob      date,
  add column if not exists link     text;

-- Username must be unique once set, but allow NULLs so legacy rows still work.
create unique index if not exists idx_users_username on users (lower(username))
  where username is not null;

-- Make password_hash nullable for OTP-only signups.
alter table users alter column password_hash drop not null;

-- Helpful index for "find by email" queries.
create index if not exists idx_users_email on users (lower(email)) where email is not null;
