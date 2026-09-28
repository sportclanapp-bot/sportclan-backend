-- ===========================================================================
-- 112 · APPLIED by Dipak 29 Sep 2026 · venues can be deleted (soft)
--
-- Decision item 7 (phase3/DECISIONS.md). Nobody could delete a venue, not even
-- its creator. DELETE /venues/:id (creator or admin) now marks the row instead
-- of removing it: deleted venues leave the directory, search and the match
-- form's picker, and their name can be added again as a new venue. Matches
-- store the venue's name, not its id, so their text is untouched.
--
-- Recorded in FIX_PLAN.md: block 1 returned 0 rows; block 2 "Success. No rows
-- returned"; block 3 returned 2 rows. Two nullable columns; no row changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing exists yet. Expected: 0 rows.
-- ---------------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'venues' AND column_name IN ('deleted_at', 'deleted_by');


-- ---------------------------------------------------------------------------
-- BLOCK 2 · CHANGES DATA (schema) · two nullable columns. No default → no
-- table rewrite, no row changed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · READ-ONLY · verify. Expected: 2 rows, deleted_at and deleted_by.
-- ---------------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'venues' AND column_name IN ('deleted_at', 'deleted_by');
