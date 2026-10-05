-- 119 · tournament_entries.fee_* — the organiser's own paid/unpaid record (cricket gap 10).
-- Applied by Dipak on 5 Oct 2026 (batch APPLY-gaps-batch-117-119.sql, part B).
-- No money moves through the app; the organiser marks a fee paid (cash/UPI outside the app).
-- Shown to organisers only. Additive and nullable: older apps unaffected.

ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS fee_paid_at   timestamptz,
  ADD COLUMN IF NOT EXISTS fee_marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fee_note      text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'tournament_entries'::regclass AND conname = 'tournament_entries_fee_note_len') THEN
    ALTER TABLE tournament_entries
      ADD CONSTRAINT tournament_entries_fee_note_len CHECK (fee_note IS NULL OR char_length(fee_note) <= 120);
  END IF;
END $$;
COMMENT ON COLUMN tournament_entries.fee_paid_at IS
  'Gap 10 (5 Oct 2026): when the organiser marked this entry''s fee paid (cash/UPI outside the app). NULL = unpaid. Shown to organisers only.';
