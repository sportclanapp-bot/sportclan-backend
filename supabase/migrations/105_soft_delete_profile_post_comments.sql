-- ===========================================================================
-- 105 · APPLY · a deleted wall-post comment is marked, not removed
-- (hard-delete list #5, decided 27 Sep 2026)
--
-- DELETE /profile-posts/comments/:commentId used to remove the row. Two people
-- may delete one: the comment's author, or the owner of the wall it is on
-- (removing someone else's words). Now the row is marked deleted_at /
-- deleted_by / deleted_reason — 'author' or 'wall_owner' — so the two stay
-- apart: the thread reads "This comment was deleted" or "Removed by the wall
-- owner".
--
-- profile_posts.comments_count was kept by a trigger on INSERT / DELETE only;
-- like 102 did for community comments, it now also fires when deleted_at
-- changes (marked → one fewer; cleared → one more), and a row hard-deleted
-- after being soft-deleted is not subtracted twice.
--
-- The backend that reads these columns must deploy AFTER this is applied.
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet; the trigger as it is today.
-- Expected: new_columns_present = 0, new_constraint_present = 0,
-- trigger_events = 'DELETE,INSERT'.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'profile_post_comments'
     AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason'))                     AS new_columns_present,
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'profile_post_comments_deleted_reason_check')                          AS new_constraint_present,
  (SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation)
     FROM information_schema.triggers
     WHERE event_object_table = 'profile_post_comments' AND trigger_name = 'trg_profile_post_comments') AS trigger_events;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · columns, check, and the count trigger.
-- Idempotent. Nullable, no default → no table rewrite; no row or count changes.
-- ---------------------------------------------------------------------------
ALTER TABLE profile_post_comments ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;
ALTER TABLE profile_post_comments ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE profile_post_comments ADD COLUMN IF NOT EXISTS deleted_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_post_comments_deleted_reason_check') THEN
    ALTER TABLE profile_post_comments ADD CONSTRAINT profile_post_comments_deleted_reason_check
      CHECK (deleted_reason IS NULL OR deleted_reason IN ('author', 'wall_owner'));
  END IF;
END $$;

-- The 075 floor kept; live comments only.
CREATE OR REPLACE FUNCTION bump_profile_post_comments() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE profile_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE profile_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE profile_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = NEW.post_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE profile_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_post_comments ON profile_post_comments;
CREATE TRIGGER trg_profile_post_comments
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON profile_post_comments
  FOR EACH ROW EXECUTE FUNCTION bump_profile_post_comments();


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 3 rows — profile_post_comments.deleted_at timestamp with time zone
-- YES, deleted_by uuid YES, deleted_reason text YES; then constraint_present =
-- 1 and trigger_events = 'DELETE,INSERT,UPDATE'.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profile_post_comments'
  AND column_name IN ('deleted_at', 'deleted_by', 'deleted_reason')
ORDER BY column_name;

SELECT
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'profile_post_comments_deleted_reason_check')                          AS constraint_present,
  (SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation)
     FROM information_schema.triggers
     WHERE event_object_table = 'profile_post_comments' AND trigger_name = 'trg_profile_post_comments') AS trigger_events;
