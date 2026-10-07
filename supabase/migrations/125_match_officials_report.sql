-- 125 · Stage 8 · F11 (Oct 2026): officials in each sport's words.
--  * tournament_officials.role gains 'assistant' (an assistant referee, line
--    judge, service judge… the sport decides the word).
--  * match_officials: the assistant officials named for one match, by the
--    sport's own role key (assistant_referee_1, fourth_official, line_judge…).
--    Soft delete: removed_at; never hard-deleted.
--  * matches.official_report: a short report by the match official
--    ({ text, by, at }); null for every existing match.
-- Additive only: existing rows keep their values.
-- The role CHECK's name may differ on live (as in 036): drop whichever CHECK names role.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'tournament_officials'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE tournament_officials DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE tournament_officials ADD CONSTRAINT tournament_officials_role_check
  CHECK (role IN ('umpire', 'referee', 'scorer', 'commentator', 'assistant'));

CREATE TABLE IF NOT EXISTS match_officials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (char_length(role) BETWEEN 1 AND 40),
  named_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);
-- One person per role per match while it stands.
CREATE UNIQUE INDEX IF NOT EXISTS match_officials_role_live
  ON match_officials (match_id, role) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS match_officials_user ON match_officials (user_id) WHERE removed_at IS NULL;
ALTER TABLE match_officials ENABLE ROW LEVEL SECURITY;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS official_report jsonb
  CHECK (official_report IS NULL OR jsonb_typeof(official_report) = 'object');
