-- Performance indexes identified by query-pattern analysis.
-- Run against production Supabase before or after deploy.

-- Matches: filtered by status on every SportHub/MatchesList load
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_sport_status ON matches(sport_id, status);

-- Community posts: city + recency is the primary feed query
CREATE INDEX IF NOT EXISTS idx_community_posts_city_created ON community_posts(city_id, created_at DESC);

-- Notifications: user's unread + chronological are the two hot queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Follow graph: follower/following lookups for profile counts
CREATE INDEX IF NOT EXISTS idx_follow_follower ON follow_relationships(follower_id);
CREATE INDEX IF NOT EXISTS idx_follow_following ON follow_relationships(following_id);

-- Leaderboard: sport + rating DESC is the ranking query
CREATE INDEX IF NOT EXISTS idx_usp_sport_rating ON user_sport_profiles(sport_id, rating DESC);

-- Message reactions + gender category for future features
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_sport_profiles ADD COLUMN IF NOT EXISTS gender_category TEXT NOT NULL DEFAULT 'open';
