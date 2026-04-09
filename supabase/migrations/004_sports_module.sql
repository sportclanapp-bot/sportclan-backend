-- SportClan sports module: teams, tournaments, matches, scoring
-- Notes:
--   Change #6: Tournament CREATION requires Premium (enforced in app layer).
--               Team and match creation are FREE for all.

-- ===== teams =====
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references sports(id) on delete cascade,
  name text not null,
  logo_url text,
  city_id uuid references cities(id),
  created_by uuid not null references users(id) on delete cascade,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_teams_sport on teams (sport_id);
create index if not exists idx_teams_city on teams (city_id);
create index if not exists idx_teams_created_by on teams (created_by);
create index if not exists idx_teams_created_at on teams (created_at desc);

-- ===== team_members =====
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'player' check (role in ('captain','vice_captain','player')),
  jersey_number int,
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create index if not exists idx_team_members_team on team_members (team_id);
create index if not exists idx_team_members_user on team_members (user_id);

-- ===== tournaments =====
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references sports(id) on delete cascade,
  name text not null,
  description text,
  format text not null check (format in ('knockout','league','round_robin','groups_knockout')),
  city_id uuid references cities(id),
  venue text,
  start_date date,
  end_date date,
  entry_fee int not null default 0,
  max_teams int,
  prize_pool int,
  banner_url text,
  status text not null default 'upcoming' check (status in ('upcoming','live','completed','cancelled')),
  entry_code text unique,
  created_by uuid not null references users(id) on delete cascade,
  tiebreaker_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tournaments_sport_status on tournaments (sport_id, status);
create index if not exists idx_tournaments_city on tournaments (city_id);
create index if not exists idx_tournaments_created_by on tournaments (created_by);
create index if not exists idx_tournaments_created_at on tournaments (created_at desc);

-- ===== tournament_entries =====
create table if not exists tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  seed int,
  group_label text,
  entered_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);
create index if not exists idx_tournament_entries_tournament_status on tournament_entries (tournament_id, status);
create index if not exists idx_tournament_entries_team on tournament_entries (team_id);

-- ===== matches =====
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references sports(id) on delete cascade,
  tournament_id uuid references tournaments(id) on delete set null,
  team_a_id uuid references teams(id) on delete set null,
  team_b_id uuid references teams(id) on delete set null,
  team_a_name text, -- denormalized for casual matches
  team_b_name text,
  scheduled_at timestamptz,
  venue text,
  city_id uuid references cities(id),
  format text,
  overs int,
  status text not null default 'scheduled' check (status in ('scheduled','live','completed','cancelled','abandoned')),
  winner_team_id uuid references teams(id) on delete set null,
  score_summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references users(id) on delete cascade,
  umpire_id uuid references users(id) on delete set null,
  squad_locked_at timestamptz,
  scorecard_locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_matches_status on matches (status);
create index if not exists idx_matches_sport_status on matches (sport_id, status);
create index if not exists idx_matches_tournament on matches (tournament_id);
create index if not exists idx_matches_created_by on matches (created_by);
create index if not exists idx_matches_scheduled_at on matches (scheduled_at desc);

-- ===== match_participants =====
create table if not exists match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  team_side text not null check (team_side in ('A','B')),
  role text,
  jersey_number int,
  batting_order int,
  unique (match_id, user_id)
);
create index if not exists idx_match_participants_match on match_participants (match_id);
create index if not exists idx_match_participants_user on match_participants (user_id);

-- ===== match_events =====
create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  event_type text not null,
  period int,
  clock_seconds int,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_match_events_match_created on match_events (match_id, created_at);

-- ============================================================
-- Realtime: run these to enable Supabase Realtime broadcasts
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE match_events;
