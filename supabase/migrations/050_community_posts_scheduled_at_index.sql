-- 050: index community_posts.scheduled_at for the scheduled-post publisher (SC-125 / AUDIT-7).
-- publishScheduledPosts scans `WHERE scheduled_at <= now()` to publish due posts;
-- with no index that is a full community_posts scan (grows with post volume).
-- A PARTIAL index (scheduled_at IS NOT NULL) is ideal: it covers only the handful
-- of actually-scheduled rows (the vast majority of posts have scheduled_at NULL),
-- so it is tiny and serves the publisher's range scan directly. The feed's
-- `scheduled_at IS NULL` filter is the non-selective common case and does not need
-- (or benefit from) this index.
--
-- 049 was taken (record_match_event_atomic) — this is 050.

-- Preflight (SC-116 lesson): verify the real column via information_schema BEFORE
-- indexing. Expect exactly one row: community_posts | scheduled_at | timestamp with time zone
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'community_posts' AND column_name = 'scheduled_at';

-- The index (idempotent).
CREATE INDEX IF NOT EXISTS idx_community_posts_scheduled_at
  ON community_posts (scheduled_at)
  WHERE scheduled_at IS NOT NULL;
