-- 163 · N-R7-S124 (Step 2, Batch 10, SPP2-VOL-050, 9 Nov 2026 · Dipak chose A): a voided
-- tournament fixture can be replaced by a fresh copy in the same place, so the organiser
-- enters the correct result. replaced_by points the voided fixture at its replacement (the
-- bracket shows the replacement; the voided one stays on everyone's history, voided). A
-- replacement cancelled by restoring the original points back at it. No foreign key: the
-- server claims the fixture (writes the copy's id) before it inserts the copy, so only one
-- tap makes a copy. Additive, no row changes, safe to run twice.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS replaced_by uuid;
CREATE INDEX IF NOT EXISTS matches_replaced_by_idx ON matches (replaced_by) WHERE replaced_by IS NOT NULL;
