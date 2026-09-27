-- ===========================================================================
-- 107 · APPLY · the scoring edit log keeps its rows, and records undos
-- (hard-delete list #7, 27 Sep 2026)
--
-- match_event_audit (migration 021) is where a scorer's edits and deletions of
-- a ball / point are logged. Two things were wrong for a DELETE:
--   • event_id REFERENCES match_events(id) ON DELETE CASCADE — so the log row
--     written just before an event is deleted was deleted WITH the event. The
--     log of deletions (DELETE /matches/:id/events/:eventId) never survived.
--   • action CHECK (action IN ('edit', 'delete')) — no way to record an undo.
-- Now: event_id is nullable and the reference is ON DELETE SET NULL (the row
-- stays; the full old event, id included, is in old_payload), and the action
-- may also be 'undo' (POST /scoring/:matchId/undo). An index serves reading a
-- match's log in order.
--
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only. No row is changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the table as it is today.
-- Expected: event_id_nullable = 'NO', event_fk_on_delete = 'c' (cascade),
-- action_check = the constraint text with ('edit', 'delete') only,
-- log_index_present = 0.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'match_event_audit' AND column_name = 'event_id') AS event_id_nullable,
  (SELECT confdeltype::text FROM pg_constraint
     WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'f'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                             WHERE attrelid = 'public.match_event_audit'::regclass AND attname = 'event_id')]) AS event_fk_on_delete,
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%action%')                                          AS action_check,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_match_event_audit_match')                                              AS log_index_present;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · keep log rows; allow 'undo'. Idempotent.
-- Constraints are replaced, not data: no row is read, changed or removed.
-- ---------------------------------------------------------------------------
ALTER TABLE match_event_audit ALTER COLUMN event_id DROP NOT NULL;

DO $$
DECLARE c text;
BEGIN
  -- The event_id foreign key, whatever it was named: re-created ON DELETE SET NULL.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.match_event_audit'::regclass AND attname = 'event_id')]
  LOOP
    EXECUTE format('ALTER TABLE match_event_audit DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE match_event_audit ADD CONSTRAINT match_event_audit_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES match_events(id) ON DELETE SET NULL;

  -- The action check, whatever it was named: now also 'undo'.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE match_event_audit DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE match_event_audit ADD CONSTRAINT match_event_audit_action_check
    CHECK (action IN ('edit', 'delete', 'undo'));
END $$;

-- A match's log, oldest first.
CREATE INDEX IF NOT EXISTS idx_match_event_audit_match
  ON match_event_audit (match_id, created_at);


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: event_id_nullable = 'YES', event_fk_on_delete = 'n' (set null),
-- action_check = CHECK ((action = ANY (ARRAY['edit'::text, 'delete'::text,
-- 'undo'::text]))), log_index_present = 1.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'match_event_audit' AND column_name = 'event_id') AS event_id_nullable,
  (SELECT confdeltype::text FROM pg_constraint
     WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'f'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                             WHERE attrelid = 'public.match_event_audit'::regclass AND attname = 'event_id')]) AS event_fk_on_delete,
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ') FROM pg_constraint
     WHERE conrelid = 'public.match_event_audit'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%action%')                                          AS action_check,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname = 'idx_match_event_audit_match')                                              AS log_index_present;
