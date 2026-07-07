-- 050: index community_posts.scheduled_at for the scheduled-post publisher (SC-125 / AUDIT-7).
-- publishScheduledPosts scans `WHERE scheduled_at <= now()` to publish due posts;
-- with no index that is a full community_posts scan (grows with post volume).
-- Tracked indexes on community_posts (migrations 005/015) cover author_id / sport_id /
-- city_id / created_at only — NONE cover scheduled_at. A PARTIAL index (NOT NULL)
-- covers just the handful of scheduled rows, so it is tiny + serves the range scan.
--
-- 049 is TAKEN (record_match_event_atomic) — this is 050.

-- ── PREFLIGHT 1: real indexes on the table (AUDIT-7 verify — catches out-of-band
--    drift, cf. the untracked `kudos` table). If ANY row here already has
--    scheduled_at as the leading key, STOP — the index already exists, skip below.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'community_posts';

-- ── PREFLIGHT 2: confirm the column name (SC-116 lesson).
--    Expect one row: community_posts | scheduled_at | timestamp with time zone
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'community_posts' AND column_name = 'scheduled_at';

-- ── APPLY (only if PREFLIGHT 1 shows no existing scheduled_at index). Idempotent.
CREATE INDEX IF NOT EXISTS idx_community_posts_scheduled_at
  ON community_posts (scheduled_at)
  WHERE scheduled_at IS NOT NULL;
