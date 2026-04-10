-- Track when username was last changed (30-day restriction)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_username_changed_at TIMESTAMPTZ;
