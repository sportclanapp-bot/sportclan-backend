-- 048: kudos one-per-(giver, receiver, match) — DB unique to close the concurrent
-- double-kudos race (Sweep-3 SC-115 / SWEEP4 SC-116). sendKudos does an
-- existing-check + returns { alreadySent } sequentially, but two concurrent sends
-- both pass the check and both insert (+ double coin credit). This adds the DB
-- guarantee. Mirrors 042 (DM dedup) / 045 (invite dedup).
--
-- Columns are the REAL kudos columns (from_user_id, to_user_id, match_id) — kudos
-- are match-scoped. NOTE: the `kudos` table has no CREATE-TABLE migration (it was
-- created out-of-band; SWEEP4 SC-121). This migration only adds the index; a
-- follow-up should capture the table definition in version control.
--
-- follows(follower_id,following_id) [001], team_members(team_id,user_id) [001],
-- user_reviews(reviewer_id,reviewed_id) [024] and tournament_entries(tournament_id,
-- team_id) [001] ALREADY have their unique constraints — intentionally NOT re-added.

-- (a) Backfill-dedup: keep the OLDEST kudos per (from,to,match), drop the rest so
--     the unique index can build. No-op when there are no dupes (confirmed 0).
WITH d AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY from_user_id, to_user_id, match_id
           ORDER BY created_at, id
         ) AS rn
  FROM kudos
)
DELETE FROM kudos WHERE id IN (SELECT id FROM d WHERE rn > 1);

-- (b) Add the unique (idempotent). match_id is always set (kudos require a match),
--     so a plain unique index is correct — no partial needed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kudos_from_to_match
  ON kudos (from_user_id, to_user_id, match_id);
