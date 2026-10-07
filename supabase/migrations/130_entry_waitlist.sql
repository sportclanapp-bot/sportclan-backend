-- 130 · Stage 9 · T13 (Oct 2026): a waitlist for full events (every sport).
-- An entry made when the event is full waits as 'waitlisted', in the order it
-- came (entered_at); a withdrawal or a bigger draw moves the first one up.
-- Widens the status check only: every existing row already passes it.
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_status_check;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text, 'waitlisted'::text]));
CREATE INDEX IF NOT EXISTS tournament_entries_waitlist ON tournament_entries (tournament_id, entered_at) WHERE status = 'waitlisted';
