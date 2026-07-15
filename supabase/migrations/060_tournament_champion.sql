-- 060_tournament_champion.sql
-- SC-253: persist the crowned champion on the tournament record.
--
-- Until now a completed tournament stored only status='completed'; the winner was
-- inferable solely from the final match + standings, so nothing could read a
-- champion (no "tournaments won" stat/badge, no result push had a source).
-- advanceTournamentWinner now writes champion_team_id at the crown transition and
-- fans out a tournament_champion notification.
--
-- ON DELETE SET NULL so deleting a team never breaks a historical tournament row.
-- Forward-only: existing completed tournaments keep champion_team_id NULL (we do
-- not backfill — the value is only meaningful for tournaments crowned by the new
-- code path).
--
-- MUST be applied BEFORE the backend deploy: the crown update writes
-- champion_team_id in the same statement as the status flip, so a missing column
-- would make that update fail and block tournament completion.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS champion_team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
