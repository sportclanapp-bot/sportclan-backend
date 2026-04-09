-- ============================================================================
-- Migration 005: Community, Chat, Search, Player Availability
-- Part 5 of SportClan
-- ============================================================================

-- ─── COMMUNITY POSTS ────────────────────────────────────────────────────────
CREATE TABLE community_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       text NOT NULL CHECK (char_length(content) <= 500),
  image_url     text,
  link_url      text,
  sport_id      uuid REFERENCES sports(id) ON DELETE SET NULL,
  city_id       uuid REFERENCES cities(id) ON DELETE SET NULL,
  post_type     text NOT NULL DEFAULT 'Player'
                CHECK (post_type IN ('Player','Match','Tournament','Umpire-Referee','Other')),
  is_closed     boolean NOT NULL DEFAULT false,
  mentions      uuid[] DEFAULT '{}',
  likes_count   int NOT NULL DEFAULT 0,
  comments_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_community_posts_author ON community_posts(author_id);
CREATE INDEX idx_community_posts_sport ON community_posts(sport_id);
CREATE INDEX idx_community_posts_city ON community_posts(city_id);
CREATE INDEX idx_community_posts_created ON community_posts(created_at DESC);

-- ─── POST LIKES ─────────────────────────────────────────────────────────────
CREATE TABLE post_likes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX idx_post_likes_post ON post_likes(post_id);

-- ─── POST COMMENTS ──────────────────────────────────────────────────────────
CREATE TABLE post_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES post_comments(id) ON DELETE CASCADE,
  content       text NOT NULL CHECK (char_length(content) <= 500),
  mentions      uuid[] DEFAULT '{}',
  reactions     jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_comments_post ON post_comments(post_id);
CREATE INDEX idx_post_comments_parent ON post_comments(parent_id);

-- ─── COMMENT REPORTS ────────────────────────────────────────────────────────
CREATE TABLE comment_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id   uuid REFERENCES post_comments(id) ON DELETE CASCADE,
  post_id      uuid REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('Spam','Offensive','Harassment','Fake','Other')),
  details      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── CHATS ──────────────────────────────────────────────────────────────────
CREATE TABLE chats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group     boolean NOT NULL DEFAULT false,
  name         text,
  icon_url     text,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chats_last_msg ON chats(last_message_at DESC NULLS LAST);

-- ─── CHAT PARTICIPANTS ──────────────────────────────────────────────────────
CREATE TABLE chat_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chat_id, user_id)
);

CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX idx_chat_participants_chat ON chat_participants(chat_id);

-- ─── MESSAGES ───────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id       uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       text,
  image_url     text,
  reply_to_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  forwarded_from uuid REFERENCES messages(id) ON DELETE SET NULL,
  is_system     boolean NOT NULL DEFAULT false,
  is_deleted    boolean NOT NULL DEFAULT false,
  read_by       uuid[] DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_chat ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- ─── PLAYER AVAILABILITY ────────────────────────────────────────────────────
CREATE TABLE player_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  status      text NOT NULL DEFAULT 'not_available'
              CHECK (status IN ('looking_to_play','available_weekend','not_available')),
  sport_ids   uuid[] DEFAULT '{}',
  date_from   date,
  date_to     date,
  hide_stats  boolean NOT NULL DEFAULT false,
  hide_dob    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_player_availability_status ON player_availability(status);

-- ─── ENABLE SUPABASE REALTIME ───────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE post_likes;

-- ─── TRIGGER: auto-update likes_count ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_post_likes_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_likes_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();

-- ─── TRIGGER: auto-update comments_count ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_post_comments_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_comments_count
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();

-- ─── TRIGGER: auto-update chat last_message_at ──────────────────────────────
CREATE OR REPLACE FUNCTION update_chat_last_message() RETURNS trigger AS $$
BEGIN
  UPDATE chats SET last_message_at = NEW.created_at WHERE id = NEW.chat_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_last_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_chat_last_message();
