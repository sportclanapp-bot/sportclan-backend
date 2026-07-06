-- 045: dedup pending play-invites (part 2 of the approval-flow work).
-- One PENDING invite per (sender_id, receiver_id, sport_id). Resolved
-- (accepted/declined) invites are EXEMPT so a declined invite can be re-sent —
-- the controller reopens the resolved row to pending. Mirrors 042 (DM dedup):
-- createInvite inserts and, on 23505, returns ALREADY_INVITED, so exactly one
-- pending invite can exist per triple even under concurrent first-time sends.
--
-- Backfill: if duplicate PENDING invites already exist for a triple, keep the
-- OLDEST (row_number = 1) and mark the rest declined so the unique index builds.
WITH dupes AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY sender_id, receiver_id, sport_id
           ORDER BY created_at, id
         ) AS rn
  FROM invites
  WHERE status = 'pending'
)
UPDATE invites
SET status = 'declined', responded_at = now()
FROM dupes
WHERE invites.id = dupes.id
  AND dupes.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invites_pending
  ON invites (sender_id, receiver_id, sport_id)
  WHERE status = 'pending';
