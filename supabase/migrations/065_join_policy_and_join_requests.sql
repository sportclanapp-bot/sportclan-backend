-- 065_join_policy_and_join_requests.sql  (SC-267)
-- Team join request/approve flow. Two additive changes; no ordering constraint
-- between them (both reference already-existing teams/users). Apply BEFORE deploy.
--
-- NOTE: co-captains need NO migration — team_members.role already allows
-- 'vice_captain' (mig 004 CHECK) and it's already the captaincy heir (RPCs 037/046).
-- SC-267 gives that existing role authority; that's a code change, not schema.

-- 1) Per-team join policy. Default 'open' = today's instant-join-by-code (every
--    existing team is unchanged). 'approval' routes code-joins + public-browse
--    joins through team_join_requests.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS join_policy TEXT NOT NULL DEFAULT 'open'
  CHECK (join_policy IN ('open', 'approval'));

-- 2) Join requests — mirrors tournament_entries (mig 004): one row per (team,user),
--    status machine, decided_by/at attribution. Re-request after rejection flips
--    the same row back to 'pending' (respecting a 24h cooldown enforced in code).
CREATE TABLE IF NOT EXISTS team_join_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_team_status
  ON team_join_requests (team_id, status);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_user
  ON team_join_requests (user_id);
