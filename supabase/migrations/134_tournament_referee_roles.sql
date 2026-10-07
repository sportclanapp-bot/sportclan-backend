-- 134 · Stage 10 · TT12 (Oct 2026): a tournament's referee and deputy referee —
-- the officials above the match umpires who decide defaults, walkovers and
-- disputes (ITTF / BWF / ITF "Referee", chess "Chief arbiter", cricket "Match
-- referee"…; each sport's own word in the app). The role CHECK is replaced by
-- the same list plus the two. No data change: every existing official keeps
-- their role.
ALTER TABLE tournament_officials DROP CONSTRAINT IF EXISTS tournament_officials_role_check;
ALTER TABLE tournament_officials ADD CONSTRAINT tournament_officials_role_check
  CHECK (role IN ('umpire', 'referee', 'scorer', 'commentator', 'assistant', 'chief_referee', 'deputy_referee'));

NOTIFY pgrst, 'reload schema';
