-- 144 · Audit #16 (11 Oct 2026): a member an admin removed from a chat is told
-- apart from one who left, so opening the match chat (or a tournament chat
-- sync) can't quietly put them back. Only an admin adding them again clears it.
-- Additive; existing rows keep removed_by null (treated as having left).
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id);
