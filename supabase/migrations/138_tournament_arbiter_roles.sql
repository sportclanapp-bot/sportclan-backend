-- 138 · Stage 12 · CH11 (Oct 2026): chess's other arbiters — a Pairings arbiter
-- (checks and publishes each Swiss round), Sector arbiters (a block of boards)
-- and an Anti-cheating (fair-play) arbiter, as FIDE lists them for Pune events.
-- Stored by function ('pairings', 'sector', 'fair_play'); each sport shows its
-- own word, and only chess offers them today. The role CHECK is replaced by the
-- same list plus the three. No data change: every existing official keeps
-- their role.
ALTER TABLE tournament_officials DROP CONSTRAINT IF EXISTS tournament_officials_role_check;
ALTER TABLE tournament_officials ADD CONSTRAINT tournament_officials_role_check
  CHECK (role IN ('umpire', 'referee', 'scorer', 'commentator', 'assistant', 'chief_referee', 'deputy_referee', 'pairings', 'sector', 'fair_play'));

NOTIFY pgrst, 'reload schema';
