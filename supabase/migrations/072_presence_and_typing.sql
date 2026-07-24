-- SC-344 · real presence + real typing (both on the existing 6s-poll mechanism).
--
-- users.last_active_at: updated by a lightweight heartbeat (app foreground + a
-- periodic ping while active). "online" = last_active_at within the online window
-- (computed server-side); otherwise offline / last-seen. Never hardcoded.
--
-- chat_participants.typing_until: set a few seconds into the future while a user is
-- actively typing in a chat; the other party's message poll reads participants whose
-- typing_until is still in the future (and clears them once it lapses / on send).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS typing_until timestamptz;
