-- 120 · tournaments.parent_id / is_parent / entry_kind / event_label / event_order (badminton gaps 1–2).
-- Applied by Dipak on 6 Oct 2026 (batch APPLY-badminton-batch-120-122.sql, part B).
-- Additive: defaults/NULL, a new table, a wider CHECK. Older apps unaffected.

-- 120 · events inside a tournament (gap 1) and singles / doubles events (gap 2)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_parent   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entry_kind  text    NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS event_label text,
  ADD COLUMN IF NOT EXISTS event_order smallint;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_entry_kind_check
  CHECK (entry_kind IN ('team', 'singles', 'doubles'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_shape_check
  CHECK (parent_id IS NULL OR (NOT is_parent AND parent_id <> id));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_label_len
  CHECK (event_label IS NULL OR char_length(event_label) BETWEEN 1 AND 60);
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_order_range
  CHECK (event_order IS NULL OR event_order BETWEEN 0 AND 99);
CREATE INDEX IF NOT EXISTS idx_tournaments_parent
  ON tournaments (parent_id, event_order) WHERE parent_id IS NOT NULL;
COMMENT ON COLUMN tournaments.parent_id IS
  'Badminton gap 1: set on an event (Men''s singles, U-15 doubles …) to the tournament it belongs to. NULL = a tournament.';
COMMENT ON COLUMN tournaments.is_parent IS
  'Badminton gap 1: true on a tournament made of events. Its own entries and fixtures stay empty; the events hold them.';
COMMENT ON COLUMN tournaments.entry_kind IS
  'Badminton gap 2: who enters — team (as today), singles (one player) or doubles (a pair). Existing rows: team.';
