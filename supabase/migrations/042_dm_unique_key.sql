-- 042: one DM conversation per pair (SC-62 — duplicate DM fix).
-- getOrCreateDM was a get-or-create with no DB uniqueness: it looked for a shared
-- non-group chat via chat_participants, and if none was found, created one. N
-- concurrent calls between the same two users all found nothing and each created
-- a new chat, yielding duplicate conversations for the same pair.
--
-- We add a normalized pair key on chats — `dm_key = '<lesser_uuid>:<greater_uuid>'`
-- — enforced by a UNIQUE index scoped to DMs (group chats keep dm_key NULL and are
-- unaffected). getOrCreateDM now inserts with the key and, on 23505, selects and
-- returns the existing chat — so exactly one conversation can exist per pair.
--
-- NOTE: uuid has no MIN/MAX aggregate, so we cast to text. The controller builds
-- the key as `[userId, other].sort().join(':')` and JS default sort is UTF-16
-- code-unit (byte) order — so we compare with COLLATE "C" (byte order) here to
-- produce a byte-identical lesser:greater key. A locale collation could disagree
-- on edge cases and mint a non-matching key.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS dm_key TEXT;

-- Backfill existing 2-party DMs. If duplicates already exist for a pair, only the
-- OLDEST chat gets the key (row_number = 1); the others keep dm_key NULL so the
-- unique index below still builds. Legacy dupes remain findable via the
-- participant lookup; no NEW dupes can be created once the index exists.
WITH pairs AS (
  SELECT cp.chat_id,
         MIN(cp.user_id::text COLLATE "C") AS u1,
         MAX(cp.user_id::text COLLATE "C") AS u2,
         COUNT(*)                          AS n
  FROM chat_participants cp
  GROUP BY cp.chat_id
),
dm AS (
  SELECT p.chat_id,
         (p.u1 || ':' || p.u2) AS k,
         row_number() OVER (PARTITION BY p.u1, p.u2 ORDER BY c.created_at, c.id) AS rn
  FROM pairs p
  JOIN chats c ON c.id = p.chat_id
  WHERE c.is_group = FALSE
    AND p.n = 2
    AND p.u1 <> p.u2
)
UPDATE chats c
SET dm_key = dm.k
FROM dm
WHERE c.id = dm.chat_id
  AND dm.rn = 1
  AND c.dm_key IS NULL;

-- Unique only where set (DMs). NULLs (groups + legacy dupes) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chats_dm_key
  ON chats (dm_key)
  WHERE dm_key IS NOT NULL;
