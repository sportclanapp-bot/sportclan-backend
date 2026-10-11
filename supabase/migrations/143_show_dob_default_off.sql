-- 143 · Audit #8 (11 Oct 2026, Dipak's decision 3): "Show date of birth" is OFF
-- by default. Additive, safe to run twice.
--  · New accounts: the column default is false (sign-up already sent false).
--  · show_dob_set_at: when the person themselves last set it (from now on).
--  · Existing accounts that never chose: off. Accounts made since sign-up began
--    hiding it (backend 5632ebe, live by 29 Sep 2026 10:50 UTC) started hidden,
--    so any of those showing it turned it on themselves and stay on. Older
--    accounts that show it still have the old default (no record of a choice
--    was kept) and become off — anyone who did choose can turn it back on.
ALTER TABLE users ALTER COLUMN show_dob SET DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_dob_set_at timestamptz;
UPDATE users SET show_dob = false
 WHERE show_dob = true AND show_dob_set_at IS NULL AND created_at < '2026-09-29T10:50:00Z';
