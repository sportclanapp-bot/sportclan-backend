-- ===========================================================================
-- 103 · APPLY · a moderator's "Remove content" is a soft delete, told apart
-- from an author's own delete, and restorable (hard-delete list #3, 27 Sep 2026)
--
-- PATCH /admin/reports/:id { action: 'remove' } used to DELETE the post or
-- comment, and ON DELETE CASCADE took other people's comments, replies, likes
-- and reports with it. It now uses the #1 / #2 soft delete (deleted_at,
-- deleted_by) and records WHY: deleted_reason = 'moderator' (an author's own
-- delete writes 'author'; rows deleted before this migration have NULL and are
-- read as 'author'). Users read "removed by a moderator"; an admin can Restore.
--
-- content_reports records the action taken on each report:
--   resolved_action  'dismissed' | 'removed' | 'restored'
--   actioned_via     the report the action was taken through — set on the
--                    OTHER reports about the same content, which stay and show
--                    as already actioned.
-- Who and when for each action also go to admin_actions (migration 064).
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · none of the new columns or constraints exist yet.
-- Expected: new_columns_present = 0, new_constraints_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name IN ('community_posts', 'post_comments') AND column_name = 'deleted_reason')
       OR (table_name = 'content_reports' AND column_name IN ('resolved_action', 'actioned_via')))) AS new_columns_present,
  (SELECT count(*) FROM pg_constraint
     WHERE conname IN ('community_posts_deleted_reason_check', 'post_comments_deleted_reason_check',
                       'content_reports_resolved_action_check'))                                 AS new_constraints_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · the columns and their checks. Idempotent.
-- Nullable, no default → no table rewrite, no row changed.
-- ---------------------------------------------------------------------------
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_reason text;
ALTER TABLE post_comments   ADD COLUMN IF NOT EXISTS deleted_reason text;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_action text;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS actioned_via uuid REFERENCES content_reports(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_posts_deleted_reason_check') THEN
    ALTER TABLE community_posts ADD CONSTRAINT community_posts_deleted_reason_check
      CHECK (deleted_reason IS NULL OR deleted_reason IN ('author', 'moderator'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_deleted_reason_check') THEN
    ALTER TABLE post_comments ADD CONSTRAINT post_comments_deleted_reason_check
      CHECK (deleted_reason IS NULL OR deleted_reason IN ('author', 'moderator'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_reports_resolved_action_check') THEN
    ALTER TABLE content_reports ADD CONSTRAINT content_reports_resolved_action_check
      CHECK (resolved_action IS NULL OR resolved_action IN ('dismissed', 'removed', 'restored'));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 4 rows — community_posts.deleted_reason text YES,
-- content_reports.actioned_via uuid YES, content_reports.resolved_action text
-- YES, post_comments.deleted_reason text YES; then constraints = 3.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name IN ('community_posts', 'post_comments') AND column_name = 'deleted_reason')
    OR (table_name = 'content_reports' AND column_name IN ('resolved_action', 'actioned_via')))
ORDER BY table_name, column_name;

SELECT count(*) AS constraints
FROM pg_constraint
WHERE conname IN ('community_posts_deleted_reason_check', 'post_comments_deleted_reason_check',
                  'content_reports_resolved_action_check');
