-- ===========================================================================
-- 098 · APPLY · soft revoke, soft leave, soft group delete, and new test
-- content flagged automatically (decided 27 Sep 2026)
--
-- Rule: no hard deletes of user data. Three places deleted rows and now mark
-- them instead:
--   • user_badges.revoked_at / revoke_reason — a badge a void takes back stays,
--     marked revoked; restoring the match clears the mark.
--   • chat_participants.left_at — leaving, being removed, or a tournament-chat
--     sync removal marks the row; rejoining clears it.
--   • chats.deleted_at — "Delete group" (and an emptied group) is marked, not
--     removed; its members and messages stay.
-- The backend deployed with this migration reads all three, so APPLY THIS
-- BEFORE the next backend deploy.
--
-- And: content created by a test account is flagged as it is created
-- (trigger), plus a one-off catch-up for what test accounts made after
-- APPLY-b03 block 5 ran.
--
-- Each block runs on its own. 1 reads; 2–4 change the schema or data; 5 reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · count first.
-- Expected: new_columns_present = 0, trigger_exists = 0, and catch_up_* =
-- the rows test accounts created since APPLY-b03 block 5 (a handful).
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'user_badges' AND column_name IN ('revoked_at', 'revoke_reason'))
       OR (table_name = 'chat_participants' AND column_name = 'left_at')
       OR (table_name = 'chats' AND column_name = 'deleted_at')))                                 AS new_columns_present,
  (SELECT count(*) FROM pg_proc WHERE proname = 'flag_test_content_on_insert')                   AS trigger_exists,
  (SELECT count(*) FROM teams       WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed)) AS catch_up_teams,
  (SELECT count(*) FROM tournaments WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed)) AS catch_up_tournaments,
  (SELECT count(*) FROM matches     WHERE NOT is_test_seed AND (created_by IN (SELECT id FROM users WHERE is_test_seed)
                                        OR tournament_id IN (SELECT id FROM tournaments WHERE is_test_seed)))      AS catch_up_matches,
  (SELECT count(*) FROM community_posts WHERE NOT is_test_seed AND author_id IN (SELECT id FROM users WHERE is_test_seed)) AS catch_up_posts,
  (SELECT count(*) FROM chats       WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed)) AS catch_up_chats,
  (SELECT count(*) FROM venues      WHERE NOT is_test_seed AND created_by IN (SELECT id FROM users WHERE is_test_seed)) AS catch_up_venues;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · the soft-delete columns. Idempotent.
-- Nullable, no default → no table rewrite; every existing row reads as
-- "not revoked / not left / not deleted".
-- ---------------------------------------------------------------------------
ALTER TABLE user_badges       ADD COLUMN IF NOT EXISTS revoked_at    timestamptz;
ALTER TABLE user_badges       ADD COLUMN IF NOT EXISTS revoke_reason text;
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS left_at       timestamptz;
ALTER TABLE chats             ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;
CREATE INDEX IF NOT EXISTS idx_chat_participants_active ON chat_participants (user_id, chat_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chats_live ON chats (id) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · CHANGES DATA (schema) · new test content is flagged on insert.
-- A row is flagged when its creator is a flagged (test) account; a match also
-- when its tournament is flagged. Real accounts' content is never touched.
-- Idempotent (CREATE OR REPLACE; triggers dropped and recreated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION flag_test_content_on_insert() RETURNS trigger AS $$
DECLARE
  creator uuid;
BEGIN
  IF NEW.is_test_seed THEN RETURN NEW; END IF;
  creator := CASE TG_TABLE_NAME WHEN 'community_posts' THEN NEW.author_id ELSE NEW.created_by END;
  IF creator IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = creator AND is_test_seed) THEN
    NEW.is_test_seed := true;
  ELSIF TG_TABLE_NAME = 'matches' AND NEW.tournament_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM tournaments WHERE id = NEW.tournament_id AND is_test_seed) THEN
    NEW.is_test_seed := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flag_test_teams ON teams;
CREATE TRIGGER trg_flag_test_teams BEFORE INSERT ON teams FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();
DROP TRIGGER IF EXISTS trg_flag_test_tournaments ON tournaments;
CREATE TRIGGER trg_flag_test_tournaments BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();
DROP TRIGGER IF EXISTS trg_flag_test_matches ON matches;
CREATE TRIGGER trg_flag_test_matches BEFORE INSERT ON matches FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();
DROP TRIGGER IF EXISTS trg_flag_test_posts ON community_posts;
CREATE TRIGGER trg_flag_test_posts BEFORE INSERT ON community_posts FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();
DROP TRIGGER IF EXISTS trg_flag_test_chats ON chats;
CREATE TRIGGER trg_flag_test_chats BEFORE INSERT ON chats FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();
DROP TRIGGER IF EXISTS trg_flag_test_venues ON venues;
CREATE TRIGGER trg_flag_test_venues BEFORE INSERT ON venues FOR EACH ROW EXECUTE FUNCTION flag_test_content_on_insert();


-- ---------------------------------------------------------------------------
-- BLOCK 4 · CHANGES DATA · one-off catch-up: flag what test accounts created
-- after APPLY-b03 block 5 ran (before the trigger existed). Returns the counts;
-- they should equal block 1's catch_up_* numbers.
-- ---------------------------------------------------------------------------
WITH tu AS (SELECT id FROM users WHERE is_test_seed),
t AS (
  UPDATE teams SET is_test_seed = true WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu) RETURNING 1
), tn AS (
  UPDATE tournaments SET is_test_seed = true WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu) RETURNING 1
), m AS (
  UPDATE matches SET is_test_seed = true
  WHERE NOT is_test_seed
    AND (created_by IN (SELECT id FROM tu)
         OR tournament_id IN (SELECT id FROM tournaments WHERE is_test_seed OR created_by IN (SELECT id FROM tu)))
  RETURNING 1
), p AS (
  UPDATE community_posts SET is_test_seed = true WHERE NOT is_test_seed AND author_id IN (SELECT id FROM tu) RETURNING 1
), c AS (
  UPDATE chats SET is_test_seed = true WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu) RETURNING 1
), v AS (
  UPDATE venues SET is_test_seed = true WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu) RETURNING 1
)
SELECT (SELECT count(*) FROM t) AS teams, (SELECT count(*) FROM tn) AS tournaments, (SELECT count(*) FROM m) AS matches,
       (SELECT count(*) FROM p) AS posts, (SELECT count(*) FROM c) AS chats, (SELECT count(*) FROM v) AS venues;


-- ---------------------------------------------------------------------------
-- BLOCK 5 · READ-ONLY · verify. Expected: new_columns = 4, triggers = 6.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'user_badges' AND column_name IN ('revoked_at', 'revoke_reason'))
       OR (table_name = 'chat_participants' AND column_name = 'left_at')
       OR (table_name = 'chats' AND column_name = 'deleted_at')))     AS new_columns,
  (SELECT count(*) FROM information_schema.triggers WHERE trigger_name LIKE 'trg_flag_test_%') AS triggers;
