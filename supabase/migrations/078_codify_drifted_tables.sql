-- SC-368 · codify the five tables that live in prod but that no migration creates.
--
-- Shapes below are transcribed from a PROD INTROSPECTION (columns, types,
-- nullability, defaults, constraints, indexes, RLS) — not inferred from what the
-- code happens to use. Where prod is loose (nullable columns the code always
-- populates), this reproduces prod, because the job of this file is to make a
-- from-scratch rebuild MATCH PRODUCTION, not to improve it.
--
-- SAFE ON PROD: every statement is IF NOT EXISTS, and nothing here adds a
-- constraint or index that prod doesn't already have — so applying it is a
-- genuine no-op against the current database.
--
-- RLS: disabled (false) on all five in prod. Not enabled here for the same
-- reason — this file documents, it does not change policy.
--
-- ONE ASSUMPTION, STATED: the introspection listed the foreign keys but not
-- their ON DELETE actions, so they are written with the default (NO ACTION). If
-- prod actually carries ON DELETE clauses, add them here.

-- ── venues (183 rows) ───────────────────────────────────────────────────────
-- The reuse dictionary behind the venues directory and upsertVenue.
-- NOTE: use_count and created_at are NULLABLE in prod despite having defaults,
-- and created_by/city_id are plain nullable FKs. Reproduced exactly.
CREATE TABLE IF NOT EXISTS venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  city_id    uuid REFERENCES cities(id),
  created_by uuid REFERENCES users(id),
  use_count  integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);
-- INDEXES: prod has venues_pkey ONLY. Deliberately NO index on name or city_id
-- here — see the note at the bottom of this file; adding them is a separate,
-- conscious change, not something a "make git match prod" migration should
-- smuggle in.

-- ── kudos (26 rows) ─────────────────────────────────────────────────────────
-- The inline UNIQUE is what produces prod's kudos_from_user_id_to_user_id_match_id_key.
CREATE TABLE IF NOT EXISTS kudos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid REFERENCES users(id),
  to_user_id   uuid REFERENCES users(id),
  match_id     uuid REFERENCES matches(id),
  message      text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (from_user_id, to_user_id, match_id)
);

-- ── seasons (1 row) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number integer NOT NULL,
  name          text NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  is_active     boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- ── season_medals ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_medals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  season_id    uuid REFERENCES seasons(id),
  sport_id     uuid REFERENCES sports(id),
  medal_type   text NOT NULL,
  final_rating integer NOT NULL,
  final_rank   integer NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, season_id, sport_id)
);

-- ── match_ratings (2 rows) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_ratings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         uuid REFERENCES matches(id),
  rater_id         uuid REFERENCES users(id),
  match_quality    integer NOT NULL CHECK (match_quality BETWEEN 1 AND 5),
  would_play_again boolean NOT NULL,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (match_id, rater_id)
);

COMMENT ON TABLE venues IS
  'SC-368: reuse dictionary of venue names (NOT a booking entity — a match''s location is the free-text matches.venue column). Codified retroactively; predates this migration in prod.';
COMMENT ON TABLE kudos IS
  'SC-368: codified retroactively. Migration 048 added a SECOND unique index on the same triple — see the duplicate-index note in Z-60.';

-- ── NOT DONE HERE, deliberately ─────────────────────────────────────────────
-- 1. venues has NO index on name and NO index on city_id in prod, so the
--    dedupe lookup (ilike on name) and city scoping are sequential scans.
--    Fine at 183 rows; it degrades. Adding them is a real change to prod's
--    shape and belongs in its own migration, not in this one. Recommended
--    statements are staged separately.
-- 2. The duplicate unique index on kudos is left exactly as prod has it.
--    Dropping one is safe but is a change, not a codification.
