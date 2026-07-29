-- SC-361 · append-only audit log for the team expense ledger.
--
-- The hole this closes: a captain could edit a ₹5,000 expense down to ₹500, or
-- delete it outright, and the ledger would look as if it had always been that
-- way. Team money needs a trail that outlives the row it describes.
--
-- ── Why this table has NO foreign keys ──────────────────────────────────────
-- Deliberate, and the single most important decision here.
--
--   * expense_id  — a FK would mean ON DELETE CASCADE (deleting the very
--                   history we need) or SET NULL (losing which expense the
--                   entries belong to). It is a plain uuid: the log keeps
--                   pointing at an expense that no longer exists, which is
--                   exactly the point.
--   * team_id     — a cascade from `teams` would erase a disbanded team's whole
--                   money history.
--   * actor_user_id — an ON DELETE SET NULL is an UPDATE, and the append-only
--                   trigger below blocks UPDATEs, so account deletion (SC-69)
--                   would fail. Plain uuid, plus a name snapshot.
--
-- Because there are no FKs, the log also snapshots what it needs to stay
-- readable on its own: actor_name and expense_title at the time of the action.
-- PostgREST can't embed without a FK, so the controller looks up current user
-- rows separately and falls back to the snapshot.

CREATE TABLE IF NOT EXISTS team_expense_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL,
  expense_id    uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),

  -- Who did it. Snapshot the name so a deleted account still reads sensibly.
  actor_user_id uuid,
  actor_name    text,

  -- What it was about, snapshotted so a DELETED expense still shows its title
  -- and value in the log.
  expense_title text,
  amount        numeric(10,2),

  -- For 'updated': {"amount": {"from": 5000, "to": 500}, ...}. Null otherwise.
  changes       jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The read path: one team's log, newest first, paginated.
CREATE INDEX IF NOT EXISTS idx_team_expense_log_team
  ON team_expense_log(team_id, created_at DESC);
-- Grouping a single expense's history (including after it is deleted).
CREATE INDEX IF NOT EXISTS idx_team_expense_log_expense
  ON team_expense_log(expense_id);

-- ── Append-only, enforced by the database ───────────────────────────────────
-- The API simply exposes no update/delete route, but that is only a promise
-- about today's code. This makes tampering impossible even for a caller
-- holding the service-role key, which is what "append-only" has to mean for an
-- audit log. Blocking DELETE unconditionally is safe precisely because nothing
-- cascades into this table (see above).
--
-- To purge test rows, an operator must consciously step around it:
--   ALTER TABLE team_expense_log DISABLE TRIGGER trg_team_expense_log_immutable;
--   -- … delete …
--   ALTER TABLE team_expense_log ENABLE TRIGGER trg_team_expense_log_immutable;

CREATE OR REPLACE FUNCTION team_expense_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'team_expense_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_expense_log_immutable ON team_expense_log;
CREATE TRIGGER trg_team_expense_log_immutable
  BEFORE UPDATE OR DELETE ON team_expense_log
  FOR EACH ROW EXECUTE FUNCTION team_expense_log_immutable();

COMMENT ON TABLE team_expense_log IS
  'SC-361: append-only audit trail for team_expenses (created/updated/deleted). Intentionally has no foreign keys so entries outlive the expense, team and user they reference; a trigger blocks UPDATE and DELETE. Visible to every team member, not just managers.';
