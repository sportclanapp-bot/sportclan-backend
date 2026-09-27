-- ===========================================================================
-- 108 · APPLY · wall posts and wall comments can be reported and removed by a
-- moderator (decided 27 Sep 2026)
--
-- content_reports.target_type allowed post / comment / user / message, so a
-- wall post (profile_posts) or wall comment (profile_post_comments) could not
-- be reported, and the #3 moderator remove / restore never reached them. Now:
--   • target_type also accepts 'profile_post' and 'profile_comment'
--   • profile_post_comments.deleted_reason also accepts 'moderator'
--     (profile_posts already did — migration 104)
--
-- The backend that writes these values must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only. No row is changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the two check rules as they are today.
-- Expected: report_types = CHECK ((target_type = ANY (ARRAY['post'::text,
-- 'comment'::text, 'user'::text, 'message'::text]))),
-- wall_comment_reasons = CHECK (((deleted_reason IS NULL) OR (deleted_reason
-- = ANY (ARRAY['author'::text, 'wall_owner'::text])))).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%target_type%')          AS report_types,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'profile_post_comments_deleted_reason_check')   AS wall_comment_reasons;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · widen the two check rules. Idempotent.
-- Both are replaced in one transaction; no row is read, changed or removed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE content_reports DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check
    CHECK (target_type IN ('post', 'comment', 'user', 'message', 'profile_post', 'profile_comment'));

  ALTER TABLE profile_post_comments DROP CONSTRAINT IF EXISTS profile_post_comments_deleted_reason_check;
  ALTER TABLE profile_post_comments ADD CONSTRAINT profile_post_comments_deleted_reason_check
    CHECK (deleted_reason IS NULL OR deleted_reason IN ('author', 'wall_owner', 'moderator'));
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: report_types lists post, comment, user, message, profile_post,
-- profile_comment; wall_comment_reasons lists author, wall_owner, moderator.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.content_reports'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%target_type%')          AS report_types,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'profile_post_comments_deleted_reason_check')   AS wall_comment_reasons;
