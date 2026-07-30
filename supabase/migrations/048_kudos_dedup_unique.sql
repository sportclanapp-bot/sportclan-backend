-- 048: DB unique constraints for the dedup-prone relations (SC-116).
-- Idempotent + safe to re-run.
--
-- REALITY CHECK (so this migration is honest about what it does):
--   follows(follower_id, following_id)      -> ALREADY UNIQUE since mig 001
--   team_members(team_id, user_id)          -> ALREADY UNIQUE since mig 001
--   user_reviews(reviewer_id, reviewed_id)  -> ALREADY UNIQUE since mig 024
--   kudos(from_user_id, to_user_id, match_id) -> MISSING  <-- the only real add
-- The three pre-existing ones are asserted defensively below (created ONLY if the
-- constraint is somehow absent); on the current prod schema they are no-ops.
--
-- Correct columns: kudos is MATCH-scoped (from_user_id/to_user_id/match_id — NOT
-- giver/receiver/sport_id); reviews are (reviewer_id, reviewed_id). NOTE: the
-- `kudos` table itself has no CREATE-TABLE migration (SWEEP4 SC-121) — this only
-- adds the index; a follow-up should capture the table definition in git.

-- ── kudos ──────────────────────────────────────────────────────────────────
-- SC-368: this file's own note said the `kudos` table has no CREATE-TABLE
-- migration. That made a FROM-SCRATCH run fail RIGHT HERE — `DELETE FROM kudos`
-- against a table nothing had created aborts the whole run, long before it
-- reaches anything else. On prod it worked only because the table already
-- existed. Migration 078 now creates it, but 078 runs AFTER this file, so the
-- body is guarded on the table existing. On prod: unchanged. On a rebuild: this
-- no-ops and 078 creates the table with its own inline UNIQUE.
DO $$
BEGIN
  IF to_regclass('public.kudos') IS NULL THEN
    RAISE NOTICE 'kudos not present yet — skipping (migration 078 creates it)';
    RETURN;
  END IF;

  -- (a) backfill-dedup: keep the OLDEST kudos per (from,to,match) so the unique
  --     can build. No-op when there are no dupes (confirmed count = 0).
  WITH d AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY from_user_id, to_user_id, match_id
             ORDER BY created_at, id
           ) AS rn
    FROM kudos
  )
  DELETE FROM kudos WHERE id IN (SELECT id FROM d WHERE rn > 1);

  -- (b) the constraint (idempotent). match_id is always set (kudos require a
  --     match) so a plain unique index is correct — no partial needed.
  -- SC-368 NOTE: prod ALREADY has two unique indexes on this triple
  -- (kudos_..._key from the inline UNIQUE, plus uq_kudos_triple). This adds a
  -- third name. Left in place so prod stays untouched; see Z-60.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_kudos_from_to_match
    ON kudos (from_user_id, to_user_id, match_id);
END $$;

-- ── follows / team_members / user_reviews (defensive no-ops) ─────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard each in a DO block:
-- create a unique index ONLY if the table currently has no unique constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'follow_relationships'::regclass AND contype = 'u'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_follower_following
      ON follow_relationships (follower_id, following_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'team_members'::regclass AND contype = 'u'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_team_user
      ON team_members (team_id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_reviews'::regclass AND contype = 'u'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_user_reviews_reviewer_reviewed
      ON user_reviews (reviewer_id, reviewed_id);
  END IF;
END $$;
