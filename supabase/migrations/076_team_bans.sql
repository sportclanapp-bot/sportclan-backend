-- SC-359 · team bans + capacity.
--
-- Problem (found in the SC-358 join audit): removing a member only deleted the
-- team_members row, so the removed user could rejoin instantly with the join
-- code. A removal has to mean something.
--
-- Deliberately a SEPARATE table rather than a soft-delete flag on team_members:
-- a ban must survive independently of membership (the row is gone), and the two
-- states are genuinely different — "was removed by a captain" vs "left on their
-- own". A voluntary leaver has NO row here and can rejoin freely.

CREATE TABLE IF NOT EXISTS team_bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who removed them. SET NULL so deleting the captain's account never erases
  -- the ban itself.
  banned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- Every join path checks (team_id, user_id) — index the exact lookup.
CREATE INDEX IF NOT EXISTS idx_team_bans_team_user ON team_bans(team_id, user_id);

COMMENT ON TABLE team_bans IS
  'SC-359: users removed from a team by a captain/co-captain. Blocks every rejoin path (code, request, approval). Cleared when a manager adds them back, which is the "undo". A voluntary leaver is never in here.';
