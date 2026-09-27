-- ===========================================================================
-- 109 · APPLY · the scoring edit log records the score either side of a change
-- (scoring edit log, decided 27 Sep 2026)
--
-- The match page's edit log reads each edit / delete / undo in words —
-- "Priya undid: Lions point, 3–1 → 2–1". match_event_audit held the event but
-- not the score it changed, and the score at that moment can't be rebuilt
-- later (other events have been edited or removed since). So each log row now
-- also keeps the match's score_summary just before the change and just after
-- it. Older rows have neither and read without the score part.
--
-- Each block runs on its own. 1 reads; 2 changes the schema; 3 reads.
-- Schema checks only. No row is changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet.
-- Expected: new_columns_present = 0.
-- ---------------------------------------------------------------------------
SELECT count(*) AS new_columns_present
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'match_event_audit'
  AND column_name IN ('score_before', 'score_after');


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · two nullable columns. Idempotent.
-- No default → no table rewrite, no row changed.
-- ---------------------------------------------------------------------------
ALTER TABLE match_event_audit ADD COLUMN IF NOT EXISTS score_before jsonb;
ALTER TABLE match_event_audit ADD COLUMN IF NOT EXISTS score_after  jsonb;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify the schema.
-- Expected: 2 rows — match_event_audit.score_after jsonb YES,
-- match_event_audit.score_before jsonb YES.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'match_event_audit'
  AND column_name IN ('score_before', 'score_after')
ORDER BY column_name;
