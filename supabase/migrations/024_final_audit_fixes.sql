-- User reviews for service accounts (umpires, coaches, businesses)
CREATE TABLE IF NOT EXISTS user_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reviewer_id, reviewed_id),
  CHECK(reviewer_id <> reviewed_id)
);
CREATE INDEX IF NOT EXISTS idx_user_reviews_reviewed ON user_reviews(reviewed_id);

-- State field for state-level ranking
ALTER TABLE users ADD COLUMN IF NOT EXISTS state TEXT;

-- Supabase function for atomic coin increment (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_coins(target_user_id UUID, amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE users SET coin_balance = coin_balance + amount WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;
