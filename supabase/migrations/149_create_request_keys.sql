-- 149 · Audit #68 (11 Oct 2026): creating a match, a tournament or a chat
-- message could make a duplicate after a timeout — the server had made it, the
-- app said it hadn't, and a retry made a second. The app now sends one key per
-- create (kept across its retries); the server stores it and, when the same
-- person sends the same key again, returns the first row instead of making
-- another. Additive: a new nullable column on each table and a partial unique
-- index that only applies when a key is set. Existing rows keep NULL and are
-- untouched. Safe to run twice.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_creator_client_key
  ON matches (created_by, client_key) WHERE client_key IS NOT NULL;

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournaments_creator_client_key
  ON tournaments (created_by, client_key) WHERE client_key IS NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_client_key
  ON messages (sender_id, client_key) WHERE client_key IS NOT NULL;
