-- SC-341 · read receipts: distinguish DELIVERED from SEEN.
--
-- messages.read_by (uuid[]) already tracks who has READ each message (drives the
-- teal "seen" ticks). There was no way to tell "sent to server" from "reached the
-- recipient's device", so a brand-new message showed two ticks immediately.
--
-- delivered_to = the set of recipients whose app has RECEIVED the message (their
-- chat-list / thread poll fetched it) but who may not have opened the thread yet.
-- Tick model: sent (recipient not in delivered_to) → 1 tick; delivered (in
-- delivered_to, not read_by) → 2 grey ticks; read (in read_by) → 2 teal ticks.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivered_to uuid[] NOT NULL DEFAULT '{}';
