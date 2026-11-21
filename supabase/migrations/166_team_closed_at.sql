-- 166 · Q39 (Step 3, Dipak chose A, 21 Nov 2026) · N-R6-E020: a team with match history whose last
-- member left stayed, empty, still listed and joinable; whoever joined next was a player with no
-- captain, and join requests to it waited forever. Such a team is now CLOSED: teams.closed_at is
-- set when its last member leaves; nobody can join it or ask to (the server answers TEAM_CLOSED),
-- it leaves Discover and search; its page and match history stay.
-- Backfill: every live club team with no members today and a history (a match or a tournament
-- entry) is closed, and the requests still pending
-- on it are rejected (no one can answer them). Additive; nothing is deleted. Safe to run twice.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS closed_at timestamptz;

UPDATE public.teams t
SET closed_at = now()
WHERE t.closed_at IS NULL
  AND t.deleted_at IS NULL
  AND t.kind = 'club'
  AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = t.id)
  AND (EXISTS (SELECT 1 FROM public.matches x WHERE x.team_a_id = t.id OR x.team_b_id = t.id)
       OR EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.team_id = t.id));

UPDATE public.team_join_requests r
SET status = 'rejected', decided_at = now()
FROM public.teams t
WHERE r.team_id = t.id AND r.status = 'pending' AND t.closed_at IS NOT NULL;
