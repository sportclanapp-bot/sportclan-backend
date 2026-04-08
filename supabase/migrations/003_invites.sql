-- Part 3 Wave 2 — play invites between users.
--
-- An invite is a directed message: sender → receiver, scoped to a sport,
-- with optional free-text + a status the receiver flips.

create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  sport_id    uuid not null references sports(id) on delete restrict,
  message     text,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);

create index if not exists idx_invites_receiver on invites (receiver_id, created_at desc);
create index if not exists idx_invites_sender   on invites (sender_id, created_at desc);
