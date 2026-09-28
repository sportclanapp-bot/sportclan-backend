-- 113 · "Available to play" is on for NEW accounts.
--
-- users.is_available was added in 012 as NOT NULL DEFAULT false. New accounts
-- now start available (register also sets it explicitly, so the app works
-- before this runs). Changing a column DEFAULT only affects rows inserted
-- afterwards: every existing account keeps the value it has. No data change.
ALTER TABLE users ALTER COLUMN is_available SET DEFAULT true;
