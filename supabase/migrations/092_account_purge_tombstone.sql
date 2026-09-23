-- ===========================================================================
-- 092 · account purge becomes a SCRUB, never a DELETE  (B2-a, option A)
--
-- purgeExpiredAccountsCore was written to hard-delete the `users` row 30 days
-- after deletion and let the database cascade. The B2-a dry run showed what
-- that would actually do: CASCADE on teams.created_by, tournaments.created_by
-- and matches.created_by destroys a whole team, its tournaments and the matches
-- OTHER people played in, because a founder left — and ten NO ACTION links
-- (kudos, mvp_user_id, match_ratings, team_expenses, …) would make the DELETE
-- throw for the entire batch anyway, permanently, from the first real account.
--
-- Decision: never hard-delete a user row. After 30 days the row is scrubbed of
-- everything personal and left as an anonymous tombstone, so every join still
-- resolves and the content the Delete account screen promises would stay can
-- actually stay.
--
-- This migration adds ONLY the marker the job needs. It is additive and
-- backward-compatible: code that does not know about purged_at is unaffected,
-- so it can (and should) be applied BEFORE the deploy.
--
-- Each block below runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · The marker.
--
-- NULL  → not yet purged (every row today).
-- set   → the 30-day scrub has run on this row and must never run again.
--
-- This is what makes the job idempotent. `deleted_at` alone cannot: it stays
-- set forever, so a job keyed only on it would re-scrub the same rows on every
-- tick, rewriting purged_at and logging phantom work each hour, for ever.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

COMMENT ON COLUMN users.purged_at IS
  'B2-a: when the 30-day post-deletion scrub ran on this row. The row is an anonymous tombstone from that moment: no personal data, but still joinable, so the posts/comments/reviews it authored keep resolving. Never implies the row was or will be deleted.';


-- ---------------------------------------------------------------------------
-- BLOCK 2 · The index the hourly sweep reads.
--
-- Partial, because the set it selects is tiny and permanently so: rows that are
-- deleted AND not yet scrubbed. Everything else — every live account — is not
-- in the index at all, which is the point: this runs once an hour forever and
-- must never turn into a scan of the users table.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_purge_due
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Proof this migration cannot have deleted anything.
--
-- Runs AFTER block 1, because it reads purged_at and block 1 is what creates
-- it. The "before" half is CHECK-092 block 1, which is why that one does not
-- name the column.
--
-- users_total, posts/comments/reviews/teams/matches must match the baseline
-- exactly; already_purged must be 0; and would_purge_now is what the first
-- hourly sweep will touch once the deploy lands.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                                    AS users_total,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)               AS soft_deleted,
  count(*) FILTER (WHERE purged_at IS NOT NULL)                AS already_purged,
  count(*) FILTER (WHERE deleted_at IS NOT NULL
                     AND purged_at IS NULL
                     AND deleted_at < now() - interval '30 days') AS would_purge_now
FROM users;
