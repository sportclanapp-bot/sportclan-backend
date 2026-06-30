-- 031: per-category notification preference toggles (A16-006).
-- Adds a jsonb column holding { category: boolean } overrides. Opt-out model:
-- a missing key (or true) means the category is enabled; only an explicit
-- false suppresses notifications of that category. Default '{}' => existing
-- users keep receiving everything until they turn something off.
--
-- Categories (parity with src/utils/notify.ts PREF_CATEGORY):
--   matches | social | gifts | milestones | digests
-- Account-critical types (subscription, payment, admin, security) are NOT
-- gated and always send.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
