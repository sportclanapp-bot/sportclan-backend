-- 067_match_join_policy.sql  (SC-279)
-- Match join request/approve flow — the match mirror of the team pattern (065).
-- Two additive changes; no ordering constraint between them (both reference the
-- already-existing matches/users tables). Apply BEFORE deploy.
--
-- Casual OPEN matches only. Tournament fixtures are never open-joinable
-- (matches.is_open defaults false and generateFixtures never sets it; lineups
-- are the organiser's via addParticipants), so join_policy does not touch them.

-- 1) Per-match join policy. Default 'open' = today's instant join_open_match
--    behaviour (every existing match unchanged). 'approval' routes joins through
--    match_join_requests; the creator (only) approves.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS join_policy TEXT NOT NULL DEFAULT 'open'
  CHECK (join_policy IN ('open', 'approval'));

-- 2) Join requests — mirrors team_join_requests (065) / tournament_entries (004):
--    one row per (match,user), status machine, decided_by/at attribution.
--    Re-request after WITHDRAWAL flips the same row back to 'pending' (the UNIQUE
--    holds — never a second row). A REJECTION is terminal for THIS match (no
--    re-request, no timer — a one-off game's rejection means "not this game",
--    which is the row's whole lifetime). Pending requests hold NO slot: capacity
--    is enforced atomically at approve time by the existing join_open_match RPC
--    (039), so over-approval is structurally impossible.
CREATE TABLE IF NOT EXISTS match_join_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  UNIQUE (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_join_requests_match_status
  ON match_join_requests (match_id, status);
CREATE INDEX IF NOT EXISTS idx_match_join_requests_user
  ON match_join_requests (user_id);
