-- 028 · Relax the community_posts.post_type CHECK constraint.
--
-- Migration 005 created post_type with a CHECK limiting it to
-- ('Player','Match','Tournament','Umpire-Referee','Other'). The v2 app uses a
-- different, lowercase type vocabulary ('general','looking_for_team',
-- 'looking_for_player','achievement','match_announcement','poll'), so every
-- create-post was failing the constraint with a 400.
--
-- This drops the rigid CHECK so the app's own type values are accepted. The
-- column stays a plain TEXT with a sensible default.

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Drop ANY check constraint on community_posts that references post_type,
  -- regardless of the auto-generated constraint name.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'community_posts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%post_type%'
  LOOP
    EXECUTE format('ALTER TABLE community_posts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Normalise the default to the app's baseline type.
ALTER TABLE community_posts ALTER COLUMN post_type SET DEFAULT 'general';
