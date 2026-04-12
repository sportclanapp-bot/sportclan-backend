-- Post scheduling support + mention parsing column
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Message mentions array for @mention notification targeting
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mention_user_ids UUID[] DEFAULT '{}';
