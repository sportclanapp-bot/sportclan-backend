-- ===========================================================================
-- 094 - push_tickets: the receipt half of Expo push delivery
--
-- Expo answers a send with a TICKET immediately and a RECEIPT about fifteen
-- minutes later saying what FCM did. A receipt of DeviceNotRegistered means the
-- app has been uninstalled from that device, and its token must be deleted, or
-- push_tokens fills with dead rows for ever.
--
-- The ticket ids have to be kept somewhere between send and check. In memory
-- would lose a cycle on every deploy (Render restarts the process), so they are
-- kept here. Rows are small and short-lived; CHECK-094 block 4 is the prune.
--
-- Additive. Safe to apply BEFORE the deploy: code that does not know about the
-- table is unaffected, and the sender tolerates the table being absent (the
-- send still happens; only the receipt check is skipped for those sends).
--
-- Each block runs on its own.
-- ===========================================================================

-- BLOCK 1 - the table
CREATE TABLE IF NOT EXISTS push_tickets (
  ticket_id   text PRIMARY KEY,
  token       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  checked_at  timestamptz
);

-- BLOCK 2 - what the hourly check reads: unchecked tickets, oldest first
CREATE INDEX IF NOT EXISTS idx_push_tickets_unchecked
  ON push_tickets (created_at)
  WHERE checked_at IS NULL;

-- BLOCK 3 - proof it is empty and ready. Expect 0 / 0.
SELECT count(*) AS tickets, count(*) FILTER (WHERE checked_at IS NULL) AS unchecked
FROM push_tickets;
