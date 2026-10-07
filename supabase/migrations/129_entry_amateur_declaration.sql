-- 129 · Stage 9 · T12 (Oct 2026): "amateurs only" events. When a player or
-- captain enters an event that asks for it, they declare nobody in the entry is
-- a coach, an ex-professional or a marker; this is when they did. Null for
-- every existing entry and for entries the organiser adds (the organiser vouches).
-- Additive: a nullable column, no default, nothing rewritten.
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS amateur_declared_at timestamptz;
