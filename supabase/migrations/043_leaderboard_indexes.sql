-- 043: leaderboard query indexes (SC-65 — perf).
-- GET /leaderboard (all-time) ranks user_sport_profiles by
-- (rating DESC, wins DESC, matches_played DESC, user_id ASC) filtered to one sport
-- with matches_played > 0, and separately runs an exact head COUNT over that same
-- filtered set plus a "profiles above my rating" COUNT. The only usable index was
-- (sport_id, rating DESC), which forces a heap fetch per row to apply the
-- matches_played > 0 filter and an extra sort for the wins/matches/user tie-break —
-- and the exact COUNT scans the whole filtered set on every request. At ~130k
-- profiles that is a full sort + full count per call, which is the p95 blowup.
--
-- This partial composite index matches the filter predicate and carries every
-- ORDER BY column, so the page query becomes an index range scan already in rank
-- order (no sort), and both COUNTs become index-only scans (no heap).
CREATE INDEX IF NOT EXISTS idx_usp_leaderboard
  ON user_sport_profiles (sport_id, rating DESC, wins DESC, matches_played DESC, user_id)
  WHERE matches_played > 0;

-- Monthly leaderboard fetches all of the current month's rating_history rows for a
-- sport (WHERE sport_id = ? AND created_at >= start_of_month). No index covered
-- (sport_id, created_at) before — only (user_id, created_at) and (match_id).
CREATE INDEX IF NOT EXISTS idx_rh_sport_created
  ON rating_history (sport_id, created_at DESC);
