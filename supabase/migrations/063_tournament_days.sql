-- 063_tournament_days.sql
-- Per-day window overrides for tournament scheduling. Real tournaments differ by
-- day (Sat 08:00–20:00, Sun 08:00–14:00). A row here overrides the tournament's
-- single daily_start_time/daily_end_time for that date; any day WITHOUT a row uses
-- the tournament default (so existing single-window tournaments are unaffected —
-- no rows → today's behavior).
--
-- The scheduler (generate-fixtures) READS this table; the create/update-tournament
-- endpoints WRITE it. Apply BEFORE the backend deploy.

CREATE TABLE IF NOT EXISTS tournament_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  day_date      DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, day_date)
);

CREATE INDEX IF NOT EXISTS idx_tournament_days_tid ON tournament_days(tournament_id);
