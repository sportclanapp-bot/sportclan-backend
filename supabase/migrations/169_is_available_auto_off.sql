-- 169 · Fix list 25 Nov 2026, item 3: "Available to play" goes off by itself after 30 days away.
-- true = the app (not the person) switched is_available off; opening the app again then switches it
-- back on. Set by the sweep (utils/availability.ts), cleared by any manual switch. Additive: no row's
-- is_available changes here. Safe to run twice.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_available_auto_off boolean NOT NULL DEFAULT false;
