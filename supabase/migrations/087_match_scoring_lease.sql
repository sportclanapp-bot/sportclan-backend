-- SC-430 · one scorer per match.
--
-- Today any eligible officiant can score any match from any phone, and nothing
-- stops two of them doing it at once. The writes do not corrupt each other —
-- an advisory lock serialises them and every event carries its own idempotency
-- key — so the failure is quieter and worse: BOTH sets count. Two scorers each
-- tapping every rally produce double the score and nothing flags it. Correction
-- is worse still, because undo is scoped to its own author: scorer B cannot undo
-- scorer A's mistake.
--
-- A lease fixes the common case without pretending to solve the hard one. One
-- row per match says who is scoring, from which device, and when we last heard
-- from them.
--
-- A SEPARATE TABLE, not columns on `matches`. The primary key IS the invariant —
-- one lease per match, enforced by the database rather than by every code path
-- that touches it — and a match row that is read on nearly every screen does not
-- grow six columns that only two screens care about.
--
-- ON EXPIRY, which is the part that has to survive a real venue: a lease whose
-- heartbeat has gone quiet is STALE, not released. Staleness only makes it
-- takeable; it never deletes the row. That distinction is the whole design:
--   * a scorer who loses signal keeps their lease, so their queued points still
--     drain when they walk back into coverage, however long that takes;
--   * a dead phone cannot block the match forever, because any other eligible
--     officiant can take a stale lease over deliberately, with a reason;
--   * and nobody is ever silently ejected — a takeover is an explicit human act,
--     recorded here, and the old device learns about it as a 409 on its next
--     write rather than by its points quietly vanishing.

CREATE TABLE IF NOT EXISTS match_scoring_leases (
  match_id      uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Per-INSTALL id, not per-person: the same scorer on a second handset is a
  -- different holder, which is exactly the case this exists to catch.
  device_id     text NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  -- Audit of the most recent takeover, kept on the row so "who took this and
  -- why" survives without a separate history table.
  taken_over_from   uuid REFERENCES users(id) ON DELETE SET NULL,
  taken_over_at     timestamptz,
  takeover_reason   text
);

COMMENT ON TABLE match_scoring_leases IS
  'SC-430: one scorer per match. PK match_id IS the invariant. A stale heartbeat '
  'makes a lease takeable, never released — so an offline scorer can still drain '
  'their queue, while a dead phone cannot block the match forever.';
COMMENT ON COLUMN match_scoring_leases.device_id IS
  'SC-430: per-install id. The same user on a second phone is a different holder.';
COMMENT ON COLUMN match_scoring_leases.heartbeat_at IS
  'SC-430: last contact. Older than the staleness window = takeable, NOT released.';

-- Takeover sweeps ask "which leases are stale", which is a heartbeat_at range scan.
CREATE INDEX IF NOT EXISTS idx_match_scoring_leases_heartbeat
  ON match_scoring_leases (heartbeat_at);
