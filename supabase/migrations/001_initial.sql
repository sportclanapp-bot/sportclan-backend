-- SportClan initial schema
-- Notes (per design changes):
--   #1 NO device_fingerprint column on users
--   #2 NO otp_attempts table (no lockout)
--   #3 NO password_history table (no reuse prevention)
--   #4 profile_picture_url has no size constraint

create extension if not exists "pgcrypto";

-- ===== cities =====
create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_cities_name on cities (name);

-- ===== sports =====
create table if not exists sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  emoji text not null,
  color text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ===== users =====
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  email text unique,
  name text not null,
  password_hash text not null,
  city_id uuid references cities(id),
  account_type text not null default 'fan',
  profile_picture_url text,
  bio text,
  is_premium boolean not null default false,
  premium_expires_at timestamptz,
  coin_balance int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_users_phone on users (phone);

-- ===== refresh_tokens =====
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_refresh_tokens_user on refresh_tokens (user_id);

-- ===== coupon_codes =====
create table if not exists coupon_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  premium_months int not null default 0,
  coins int not null default 0,
  max_uses int,
  uses_count int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ===== coupon_usages =====
create table if not exists coupon_usages (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupon_codes(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  used_at timestamptz not null default now(),
  unique (coupon_id, user_id)
);

-- ===== push_tokens =====
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios','android','web')),
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

-- ===== notifications =====
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on notifications (user_id, created_at desc);

-- ===== follow_relationships =====
create table if not exists follow_relationships (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references users(id) on delete cascade,
  following_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

-- ===== user_account_types =====
create table if not exists user_account_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_type text not null,
  created_at timestamptz not null default now(),
  unique (user_id, account_type)
);

-- ===== user_sports =====
create table if not exists user_sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sport_id uuid not null references sports(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, sport_id)
);

-- ===== user_blocks =====
create table if not exists user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ============================================================
-- Seed: 50 Indian cities
-- ============================================================
insert into cities (name, state) values
  ('Mumbai','Maharashtra'),
  ('Delhi','Delhi'),
  ('Bengaluru','Karnataka'),
  ('Hyderabad','Telangana'),
  ('Ahmedabad','Gujarat'),
  ('Chennai','Tamil Nadu'),
  ('Kolkata','West Bengal'),
  ('Pune','Maharashtra'),
  ('Jaipur','Rajasthan'),
  ('Surat','Gujarat'),
  ('Lucknow','Uttar Pradesh'),
  ('Kanpur','Uttar Pradesh'),
  ('Nagpur','Maharashtra'),
  ('Indore','Madhya Pradesh'),
  ('Thane','Maharashtra'),
  ('Bhopal','Madhya Pradesh'),
  ('Visakhapatnam','Andhra Pradesh'),
  ('Patna','Bihar'),
  ('Vadodara','Gujarat'),
  ('Ghaziabad','Uttar Pradesh'),
  ('Ludhiana','Punjab'),
  ('Agra','Uttar Pradesh'),
  ('Nashik','Maharashtra'),
  ('Faridabad','Haryana'),
  ('Meerut','Uttar Pradesh'),
  ('Rajkot','Gujarat'),
  ('Varanasi','Uttar Pradesh'),
  ('Srinagar','Jammu and Kashmir'),
  ('Aurangabad','Maharashtra'),
  ('Dhanbad','Jharkhand'),
  ('Amritsar','Punjab'),
  ('Navi Mumbai','Maharashtra'),
  ('Allahabad','Uttar Pradesh'),
  ('Howrah','West Bengal'),
  ('Ranchi','Jharkhand'),
  ('Gwalior','Madhya Pradesh'),
  ('Jabalpur','Madhya Pradesh'),
  ('Coimbatore','Tamil Nadu'),
  ('Vijayawada','Andhra Pradesh'),
  ('Jodhpur','Rajasthan'),
  ('Madurai','Tamil Nadu'),
  ('Raipur','Chhattisgarh'),
  ('Kota','Rajasthan'),
  ('Chandigarh','Chandigarh'),
  ('Guwahati','Assam'),
  ('Solapur','Maharashtra'),
  ('Hubballi','Karnataka'),
  ('Mysuru','Karnataka'),
  ('Tiruchirappalli','Tamil Nadu'),
  ('Bareilly','Uttar Pradesh')
on conflict do nothing;

-- ============================================================
-- Seed: 11 sports
-- ============================================================
insert into sports (name, slug, emoji, color, display_order) values
  ('Cricket','cricket','🏏','#1B5E20',1),
  ('Football','football','⚽','#0D47A1',2),
  ('Basketball','basketball','🏀','#E65100',3),
  ('Badminton','badminton','🏸','#4A148C',4),
  ('Tennis','tennis','🎾','#827717',5),
  ('Table Tennis','table-tennis','🏓','#B71C1C',6),
  ('Volleyball','volleyball','🏐','#F57F17',7),
  ('Hockey','hockey','🏑','#006064',8),
  ('Kabaddi','kabaddi','🤼','#3E2723',9),
  ('Chess','chess','♟️','#212121',10),
  ('Athletics','athletics','🏃','#BF360C',11)
on conflict (slug) do nothing;

-- ============================================================
-- Seed: EARLYBIRDS coupon — 3 months premium + 50 coins, expires 2026-09-12
-- ============================================================
insert into coupon_codes (code, description, premium_months, coins, expires_at, active)
values ('EARLYBIRDS','Early bird launch reward', 3, 50, '2026-09-12T23:59:59Z', true)
on conflict (code) do nothing;
