-- 032: ranked matches (A5-003/004 Phase 3).
-- A ranked match counts toward ELO / leaderboards and requires registered teams
-- with a lineup (>=2 players per side, enforced in the API). Casual matches
-- (the default) never touch ELO. Existing matches default to casual.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS is_ranked boolean NOT NULL DEFAULT false;
