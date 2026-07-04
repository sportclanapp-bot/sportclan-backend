-- 036 · Widen tournament_officials.role CHECK to include 'referee' (SC-56).
--
-- Migration 020 created tournament_officials.role with
--   CHECK (role IN ('umpire','scorer','commentator'))
-- but the app's OFFICIAL_ROLES (TournamentDetailScreen) has always offered a
-- "Referee" role — a legit official for football / hockey / basketball. Adding
-- a Referee therefore violated the CHECK and the insert 500'd, so that role
-- could never actually be saved (dead-end, same class as SC-55).
--
-- This drops the old role CHECK (name-agnostic, matching migration 028's
-- approach so it works regardless of the auto-generated constraint name) and
-- re-adds it with 'referee' included. umpire / scorer / commentator are kept.
-- The UNIQUE(tournament_id, user_id, role) constraint is untouched. No data
-- migration is needed — existing rows all use the retained roles.

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Drop ANY check constraint on tournament_officials that references `role`,
  -- regardless of the auto-generated constraint name.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'tournament_officials'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE tournament_officials DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE tournament_officials
  ADD CONSTRAINT tournament_officials_role_check
  CHECK (role IN ('umpire', 'referee', 'scorer', 'commentator'));
