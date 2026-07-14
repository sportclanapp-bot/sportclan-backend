-- 059 · pg_trgm GIN indexes to accelerate ILIKE '%q%' search (P-1 perf: ~1s
-- sequential scans on the 10k seed). Trigram GIN is the correct index type for
-- leading+trailing-wildcard ILIKE — it does NOT change results, only speed.
-- Column-verified (SC-116): users.name/username, teams.name, tournaments.name,
-- community_posts.content all exist as text columns.
--
-- Run in the Supabase SQL editor in small pieces (below). Each CREATE INDEX
-- IF NOT EXISTS is idempotent; on the 10k seed the build is fast (brief lock).
-- If you prefer zero-lock, run each as CREATE INDEX CONCURRENTLY instead (must
-- be run OUTSIDE a transaction, one at a time).

-- Piece 1 — extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Piece 2 — users (players / umpires / coaches / businesses / account-type search)
CREATE INDEX IF NOT EXISTS idx_users_name_trgm     ON users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops);

-- Piece 3 — teams
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm ON teams USING gin (name gin_trgm_ops);

-- Piece 4 — tournaments
CREATE INDEX IF NOT EXISTS idx_tournaments_name_trgm ON tournaments USING gin (name gin_trgm_ops);

-- Piece 5 — community_posts (post content search)
CREATE INDEX IF NOT EXISTS idx_community_posts_content_trgm ON community_posts USING gin (content gin_trgm_ops);

-- Verify the indexes exist + are trigram GIN:
-- SELECT indexname, indexdef FROM pg_indexes
--   WHERE indexname LIKE '%\_trgm' ESCAPE '\' ORDER BY indexname;
-- Confirm an index scan (not seq scan) on a search query:
-- EXPLAIN ANALYZE SELECT id FROM users WHERE name ILIKE '%sharma%' LIMIT 20;
