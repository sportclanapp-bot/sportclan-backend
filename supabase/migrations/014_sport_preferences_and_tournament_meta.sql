-- Migration 014 — per-sport preferences + tournament sport metadata.
--
-- FIX 1: the app has UI for editing per-sport preferences but the schema
-- only has rating/stats on user_sport_profiles. This adds the full set of
-- columns used by src/config/sportFields.ts so the backend can persist
-- batting_style, dominant_hand, position, etc. Every sport reuses whichever
-- columns apply — a cricket profile fills batting_style/bowling_style/role,
-- a badminton profile fills dominant_hand/play_type/preferred_position, etc.
--
-- FIX 3: tournaments gains a sport_metadata JSONB column so the
-- CreateTournamentScreen can forward arbitrary sport-specific fields
-- (ball type, pitch type, game points, etc.) without another migration
-- every time the form grows.
--
-- All additive / idempotent.

-- ─── FIX 1: user_sport_profiles preferences ────────────────────────────────
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS batting_style TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS bowling_style TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS dominant_hand TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS play_type TEXT[];
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS preferred_position TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS playing_level TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS preferred_foot TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS position TEXT[];
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS play_style TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS backhand_type TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS grip_type TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS preferred_side TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS playing_style TEXT;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS stick_type TEXT;

-- ─── FIX 3: tournaments.sport_metadata ────────────────────────────────────
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sport_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
