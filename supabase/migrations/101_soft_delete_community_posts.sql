-- ===========================================================================
-- 101 · APPLY · a deleted community post is marked, not removed
-- (hard-delete list item #1, decided 27 Sep 2026)
--
-- DELETE /community/posts/:id used to remove the row, and ON DELETE CASCADE
-- took other people's comments, the likes, and the reports made against the
-- post with it. Now the post is marked deleted_at / deleted_by and everything
-- that hangs off it stays. Normal users stop seeing it everywhere; admins still
-- can, with its reports.
--
-- Notifications about the post (likes, comments, mentions, new-post) point at
-- it through data->>'post_id' with no foreign key. They are marked hidden_at
-- in the same request, not deleted, so the inbox, the unread badge and the
-- filter counts all stop counting them.
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet.
-- Expected: new_columns_present = 0, new_indexes_present = 0,
-- posts_total and notifications_with_post_id = the current row counts.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'community_posts' AND column_name IN ('deleted_at', 'deleted_by'))
       OR (table_name = 'notifications'   AND column_name = 'hidden_at')))            AS new_columns_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname IN ('idx_community_posts_live_feed', 'idx_notifications_post_id')) AS new_indexes_present,
  (SELECT count(*) FROM community_posts)                                              AS posts_total,
  (SELECT count(*) FROM notifications WHERE data ? 'post_id')                         AS notifications_with_post_id;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · the columns and two indexes. Idempotent.
-- Nullable, no default → no table rewrite; every existing post reads as
-- "not deleted" and every notification as "not hidden".
-- ---------------------------------------------------------------------------
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications   ADD COLUMN IF NOT EXISTS hidden_at  timestamptz;
-- The feed reads live posts newest first.
CREATE INDEX IF NOT EXISTS idx_community_posts_live_feed
  ON community_posts (created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- Deleting a post finds its notifications by data->>'post_id'.
CREATE INDEX IF NOT EXISTS idx_notifications_post_id
  ON notifications ((data->>'post_id')) WHERE data ? 'post_id';


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify.
-- Expected: 3 rows — community_posts.deleted_at timestamp with time zone YES,
-- community_posts.deleted_by uuid YES, notifications.hidden_at timestamp with
-- time zone YES; then indexes = 2, deleted_posts = 0, hidden_notifications = 0.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'community_posts' AND column_name IN ('deleted_at', 'deleted_by'))
    OR (table_name = 'notifications'   AND column_name = 'hidden_at'))
ORDER BY table_name, column_name;

SELECT
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname IN ('idx_community_posts_live_feed', 'idx_notifications_post_id')) AS indexes,
  (SELECT count(*) FROM community_posts WHERE deleted_at IS NOT NULL)                 AS deleted_posts,
  (SELECT count(*) FROM notifications WHERE hidden_at IS NOT NULL)                    AS hidden_notifications;
