-- ===========================================================================
-- 102 · APPLY · a deleted comment is marked, not removed
-- (hard-delete list #2, decided 27 Sep 2026)
--
-- DELETE /community/comments/:commentId used to remove the row, and ON DELETE
-- CASCADE took the replies other people wrote to it (parent_id) and the reports
-- made against it (comment_reports) with it. Now the comment is marked
-- deleted_at / deleted_by; its replies and reports stay. In the thread it reads
-- "This comment was deleted" so the replies still answer something.
--
-- comments_count was kept by a trigger on INSERT / DELETE only, so a soft
-- delete would leave the count too high. The trigger now also fires when
-- deleted_at changes: marked deleted → one fewer; restored → one more. A row
-- that is hard-deleted after being soft-deleted is not subtracted twice.
--
-- Notifications about the comment (new comment, mention in it) are hidden
-- through notifications.hidden_at (migration 101), found by
-- data->>'comment_id' — indexed here.
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet; the trigger as it is today.
-- Expected: new_columns_present = 0, new_index_present = 0,
-- trigger_events = 'DELETE,INSERT', comments_total = the current row count,
-- and count_drift = the number of posts whose comments_count differs from
-- their real comment rows (seed data; 093 block 2 was deferred — recorded, not
-- fixed here).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'post_comments' AND column_name IN ('deleted_at', 'deleted_by'))   AS new_columns_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_notifications_comment_id')                                     AS new_index_present,
  (SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation)
     FROM information_schema.triggers
     WHERE event_object_table = 'post_comments' AND trigger_name = 'trg_post_comments_count') AS trigger_events,
  (SELECT count(*) FROM post_comments)                                                     AS comments_total,
  (SELECT count(*) FROM community_posts p
     WHERE p.comments_count <> (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id)) AS count_drift;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · columns, index, and the count trigger.
-- Idempotent. Nullable, no default → no table rewrite; every existing comment
-- reads as "not deleted". No row's data or count is changed by this block.
-- ---------------------------------------------------------------------------
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Deleting a comment finds its notifications by data->>'comment_id'.
CREATE INDEX IF NOT EXISTS idx_notifications_comment_id
  ON notifications ((data->>'comment_id')) WHERE data ? 'comment_id';

-- The 093 floor kept; live comments only.
CREATE OR REPLACE FUNCTION update_post_comments_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE community_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE community_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = NEW.post_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_comments_count ON post_comments;
CREATE TRIGGER trg_post_comments_count
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON post_comments
  FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema (columns, index, trigger events).
-- Expected: 2 rows — post_comments.deleted_at timestamp with time zone YES,
-- post_comments.deleted_by uuid YES; then new_index_present = 1 and
-- trigger_events = 'DELETE,INSERT,UPDATE'.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'post_comments'
  AND column_name IN ('deleted_at', 'deleted_by')
ORDER BY column_name;

SELECT
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_notifications_comment_id')                                     AS new_index_present,
  (SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation)
     FROM information_schema.triggers
     WHERE event_object_table = 'post_comments' AND trigger_name = 'trg_post_comments_count') AS trigger_events;
