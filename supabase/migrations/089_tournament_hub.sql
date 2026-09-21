-- SC-433 · the organiser's phone as an offline tournament hub.
--
-- At a venue with no signal the organiser still has to run the day: collect
-- results from scorers, work out who plays next, and keep a table people can
-- look at. Today none of that is possible without a network, and the app's
-- honest answer ("couldn't load") is no help to someone standing on a court
-- with sixteen teams waiting.
--
-- The hub collects results locally and syncs later. Two things need to exist on
-- the server for that to be safe, and only two — everything else the hub does is
-- a local view over data it already downloaded.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · One hub per tournament.
--
-- Deliberately the same shape and the same rules as match_scoring_leases (087),
-- because it is the same problem one level up and the semantics are already
-- tested and understood: the primary key IS the invariant, the holder is a
-- (person, DEVICE) pair, and a quiet heartbeat makes a lease TAKEABLE, never
-- released.
--
-- That last distinction matters more here than it does for a match. A hub that
-- goes quiet is the normal case — it is at a venue with no signal, which is the
-- entire point — so "stale" can never mean "abandoned". It means another
-- organiser MAY take over deliberately, with a reason, and the displaced hub
-- learns about it as a 409 at sync while keeping every result it collected.
CREATE TABLE IF NOT EXISTS tournament_hub_leases (
  tournament_id uuid PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  taken_over_from uuid REFERENCES users(id) ON DELETE SET NULL,
  taken_over_at   timestamptz,
  takeover_reason text
);

COMMENT ON TABLE tournament_hub_leases IS
  'SC-433: one offline hub per tournament. Same rules as match_scoring_leases: '
  'PK is the invariant, holder is a (person, device) pair, a stale heartbeat is '
  'takeable and never released — a hub with no signal is the normal case.';
COMMENT ON COLUMN tournament_hub_leases.heartbeat_at IS
  'SC-433: last contact. Older than the staleness window = takeable, NOT released.';

CREATE INDEX IF NOT EXISTS idx_tournament_hub_leases_heartbeat
  ON tournament_hub_leases (heartbeat_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Results that disagree with the play.
--
-- A hub can carry a RESULT ("A won 21-19") signed by a scorer, and that same
-- scorer's phone can later sync the ball-by-ball it was holding. Those two can
-- disagree: the result says A, the events add up to B. One of them is wrong and
-- the server cannot know which — the events could be incomplete, or the result
-- could have been recorded on the wrong court.
--
-- So it does not choose. It records the disagreement and hands it to a human,
-- because a tournament result that quietly flipped is far worse than one that
-- stopped and asked. NOTHING is overwritten in either direction: the recorded
-- result stands until an organiser resolves this row.
--
-- Checked in BOTH directions, which is why this table exists rather than a
-- one-shot check at upload:
--   * a result arriving for a match that already has events, and
--   * events arriving for a match that already has a recorded result.
-- The second is the one a single check at upload time would miss entirely.
CREATE TABLE IF NOT EXISTS result_discrepancies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  -- What the match currently says, and what the play adds up to.
  recorded_winner_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  derived_winner_side     text,   -- 'A' | 'B' | 'draw'
  recorded_side           text,   -- 'A' | 'B' | 'draw'
  -- Enough to reconstruct the argument without re-deriving it later.
  recorded_summary jsonb,
  derived_summary  jsonb,
  -- 'result_op'  → a signed result arrived and disagreed with events already here
  -- 'events'     → events arrived and disagreed with a result already recorded
  detected_by   text NOT NULL,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'kept_recorded' | 'took_derived' — always a human's word, never inferred.
  resolution    text
);

COMMENT ON TABLE result_discrepancies IS
  'SC-433: a recorded result and the ball-by-ball disagree. The server records '
  'the argument and changes nothing — an organiser decides. Raised in both '
  'directions: a result meeting existing events, and events meeting an existing '
  'result.';

-- One open row per match is all anyone needs; a second detection of the same
-- unresolved argument must not pile up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_result_discrepancies_open
  ON result_discrepancies (match_id)
  WHERE resolved_at IS NULL;

-- The organiser's view is "what is open for this tournament".
CREATE INDEX IF NOT EXISTS idx_result_discrepancies_open
  ON result_discrepancies (tournament_id, detected_at DESC)
  WHERE resolved_at IS NULL;
