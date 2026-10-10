-- 141 · Stage 13 follow-up (Oct 2026): no caps — the organiser's numbers are
-- never refused because of a column's size. Every column below held a number
-- the app and the server no longer cap; only its type (integer: up to
-- 2,147,483,647; numeric(4,1): up to 999.9; numeric(10,2): up to 99,999,999.99)
-- still did. They widen: integer → bigint, the decimals → wider decimals.
-- Widening only: every existing value fits and stays exactly as it is; no
-- CHECK, view or index depends on these types. Each ALTER rewrites its table
-- once (a brief lock) — run off-peak.
-- Not here (on purpose): match_events.period / clock_seconds (scoring
-- internals, written through record_match_event's integer parameters — a
-- clock of 68 years); counters, ratings and payments the organiser doesn't type.
ALTER TABLE IF EXISTS tournaments
  ALTER COLUMN entry_fee TYPE bigint,
  ALTER COLUMN prize_pool TYPE bigint,
  ALTER COLUMN max_teams TYPE bigint,
  ALTER COLUMN match_duration_minutes TYPE bigint,
  ALTER COLUMN buffer_minutes TYPE bigint,
  ALTER COLUMN ground_count TYPE bigint,
  ALTER COLUMN num_groups TYPE bigint,
  ALTER COLUMN group_size TYPE bigint,
  ALTER COLUMN qualifiers_per_group TYPE bigint;
ALTER TABLE IF EXISTS matches
  ALTER COLUMN overs TYPE bigint,
  ALTER COLUMN players_needed TYPE bigint;
ALTER TABLE IF EXISTS innings_stats
  ALTER COLUMN runs TYPE bigint,
  ALTER COLUMN balls_faced TYPE bigint,
  ALTER COLUMN fours TYPE bigint,
  ALTER COLUMN sixes TYPE bigint,
  ALTER COLUMN bowling_runs TYPE bigint,
  ALTER COLUMN bowling_wickets TYPE bigint,
  ALTER COLUMN bowling_maidens TYPE bigint,
  ALTER COLUMN catches TYPE bigint,
  ALTER COLUMN runouts TYPE bigint,
  ALTER COLUMN stumpings TYPE bigint,
  ALTER COLUMN bowling_overs TYPE numeric(20,1);
ALTER TABLE IF EXISTS match_participants
  ALTER COLUMN jersey_number TYPE bigint,
  ALTER COLUMN batting_order TYPE bigint;
ALTER TABLE IF EXISTS team_members ALTER COLUMN jersey_number TYPE bigint;
ALTER TABLE IF EXISTS tournament_squads ALTER COLUMN jersey_number TYPE bigint;
ALTER TABLE IF EXISTS tournament_entries ALTER COLUMN seed TYPE bigint;
ALTER TABLE IF EXISTS team_expenses ALTER COLUMN amount TYPE numeric(20,2);
ALTER TABLE IF EXISTS team_expense_log ALTER COLUMN amount TYPE numeric(20,2);

NOTIFY pgrst, 'reload schema';
