-- ===========================================================================
-- 104 · APPLY · a deleted wall post is marked, not removed
-- (hard-delete list #4, decided 27 Sep 2026)
--
-- DELETE /profilePosts/:id used to remove the row, and ON DELETE CASCADE took
-- other people's comments and likes on it (profile_post_comments,
-- profile_post_likes) with it. Now the row is marked deleted_at / deleted_by /
-- deleted_reason (the #1–#3 columns; 'author' is the only reason for now —
-- wall posts can't be reported, so there is no moderator removal yet).
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet.
-- Expected: new_columns_present = 0, new_constraint_present = 0,
-- new_index_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'profile_posts' AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason')) AS new_columns_present,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'profile_posts_deleted_reason_check')          AS new_constraint_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_profile_posts_live_wall')                                                  AS new_index_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · columns, check, index. Idempotent.
-- Nullable, no default → no table rewrite, no row changed.
-- ---------------------------------------------------------------------------
ALTER TABLE profile_posts ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;
ALTER TABLE profile_posts ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE profile_posts ADD COLUMN IF NOT EXISTS deleted_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_posts_deleted_reason_check') THEN
    ALTER TABLE profile_posts ADD CONSTRAINT profile_posts_deleted_reason_check
      CHECK (deleted_reason IS NULL OR deleted_reason IN ('author', 'moderator'));
  END IF;
END $$;

-- A wall reads one author's live posts, newest first.
CREATE INDEX IF NOT EXISTS idx_profile_posts_live_wall
  ON profile_posts (author_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 3 rows — profile_posts.deleted_at timestamp with time zone YES,
-- deleted_by uuid YES, deleted_reason text YES; then constraint = 1, index = 1.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profile_posts'
  AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason')
ORDER BY column_name;

SELECT
  (SELECT count(*) FROM pg_constraint WHERE conname = 'profile_posts_deleted_reason_check') AS constraint_present,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_profile_posts_live_wall')                                         AS index_present;
