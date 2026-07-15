-- 064_co_organisers_and_admin_audit.sql
-- Co-organisers + narrow admin override with an audit trail.
--
-- tournament_organisers: delegated organisers. The CREATOR stays on
-- tournaments.created_by; the full organiser set = created_by ∪ this table. A
-- co-organiser does all OPERATIONAL actions; managing co-orgs and cancelling/
-- completing the tournament stay creator-only (or admin, logged). Separate from
-- tournament_officials (mig 036 — officials officiate; co-organisers administer)
-- and from organiser_name/organiser_mobile (display-only contact fields).
--
-- admin_actions: attribution for admin OVERRIDE. A row is written ONLY when the
-- sole thing authorizing a mutation was users.is_admin (not creator/co-org) — so
-- an admin rescue is never silently indistinguishable from the organiser's edit.
--
-- Apply BEFORE the backend deploy: the auth helpers read tournament_organisers
-- and write admin_actions.

CREATE TABLE IF NOT EXISTS tournament_organisers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'co_organiser',
  added_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_organisers_tid ON tournament_organisers(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_organisers_uid ON tournament_organisers(user_id);

CREATE TABLE IF NOT EXISTS admin_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action        text NOT NULL,          -- e.g. 'cancel_tournament','reassign_organiser','force_complete_tournament'
  target_type   text NOT NULL,          -- e.g. 'tournament'
  target_id     uuid NOT NULL,
  summary       text,                   -- human-readable before→after / context
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);
