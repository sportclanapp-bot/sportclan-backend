-- Feature batch: season recap, sponsor, last_active, new achievements
-- Run against production Supabase.

-- Sponsor fields on tournaments
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sponsor_name TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS sponsor_logo_url TEXT;

-- Last-active tracking for re-engagement notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now();

-- New achievement badge definitions (seed)
INSERT INTO badges (slug, name, description, category, emoji, threshold)
VALUES
  -- Cricket
  ('century_club',       'Century Club',       'Scored 100+ runs in a single match',           'cricket',    '💯', 1),
  ('hat_trick_hero',     'Hat-trick Hero',     'Took 3 wickets in 3 consecutive balls',        'cricket',    '🎩', 1),
  ('opening_ace',        'Opening Ace',        'Opened batting and scored 50+',                'cricket',    '🏏', 1),
  -- Badminton
  ('shutout_king',       'Shutout King',       'Won a game 21-0',                              'badminton',  '🏸', 1),
  ('comeback_king',      'Comeback King',      'Won match after losing first set by 10+ pts',  'badminton',  '🔥', 1),
  ('rubber_specialist',  'Rubber Specialist',  'Won 5 matches that went to deciding set',      'badminton',  '🎯', 5),
  -- Football
  ('hat_trick',          'Hat-trick',          'Scored 3 goals in one match',                  'football',   '⚽', 1),
  ('clean_sheet',        'Clean Sheet',        'Goalkeeper with 5 clean sheets',               'football',   '🧤', 5),
  ('assist_king',        'Assist King',        '3+ assists in one match',                      'football',   '🤝', 1),
  -- Chess
  ('blitz_king',         'Blitz King',         'Won 5 blitz games in a row',                   'chess',      '⚡', 5),
  ('endgame_master',     'Endgame Master',     'Won 10 matches after reaching endgame',        'chess',      '♟️', 10),
  -- General
  ('social_butterfly',   'Social Butterfly',   'Followed 50 players',                          'general',    '🦋', 50),
  ('gift_giver',         'Gift Giver',         'Sent 20 gifts',                                'general',    '🎁', 20),
  ('tournament_veteran', 'Tournament Veteran', 'Participated in 10 tournaments',               'general',    '🏆', 10),
  ('comeback_player',    'Comeback Player',    'Won after 3 consecutive losses',               'general',    '💪', 1)
ON CONFLICT (slug) DO NOTHING;
