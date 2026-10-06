-- 122 · matches.result_type 'retired' + matches.called_at / called_by (badminton gaps 5–6).
-- Applied by Dipak on 6 Oct 2026 (batch APPLY-badminton-batch-120-122.sql, part B).
-- Additive: defaults/NULL, a new table, a wider CHECK. Older apps unaffected.

ALTER TABLE matches DROP CONSTRAINT matches_result_type_check;
ALTER TABLE matches ADD CONSTRAINT matches_result_type_check
  CHECK (result_type IS NULL OR result_type IN ('decisive', 'draw', 'walkover', 'retired'));
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS called_by uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN matches.called_at IS
  'Badminton gap 5: when the desk called this fixture to its court (matches.ground_label). NULL = not called.';

NOTIFY pgrst, 'reload schema';
