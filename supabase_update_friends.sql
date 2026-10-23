-- UPDATE: friends + recent contacts.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN. If Supabase offers to "enable RLS" for you, run it AS WRITTEN:
-- this file already turns on Row Level Security for both new tables.

-- ===== FRIENDSHIPS =====
-- One row per friend request. status: 'pending' (sent, not answered yet) or 'accepted'.
-- Names are stored here too, because people can't read each other's profiles.
create table if not exists friendships (
  id             bigint generated always as identity primary key,
  requester      uuid not null default auth.uid() references auth.users on delete cascade,
  addressee      uuid not null references auth.users on delete cascade,
  requester_name text not null,
  addressee_name text not null,
  status         text not null default 'pending',
  created_at     timestamptz not null default now(),
  unique (requester, addressee)
);
alter table friendships enable row level security;

-- You can see a friendship only if you're one of the two people in it
drop policy if exists "See my friendships" on friendships;
create policy "See my friendships" on friendships
  for select using (auth.uid() = requester or auth.uid() = addressee);
-- You can only send requests as yourself, and not to yourself
drop policy if exists "Send friend requests" on friendships;
create policy "Send friend requests" on friendships
  for insert with check (auth.uid() = requester and requester <> addressee);
-- Only the person who RECEIVED a request can accept it
drop policy if exists "Answer requests sent to me" on friendships;
create policy "Answer requests sent to me" on friendships
  for update using (auth.uid() = addressee) with check (auth.uid() = addressee);
-- Either person can remove the friendship (or cancel / decline a request)
drop policy if exists "Remove my friendships" on friendships;
create policy "Remove my friendships" on friendships
  for delete using (auth.uid() = requester or auth.uid() = addressee);

-- ===== RECENT CONTACTS =====
-- One row per PAIR of people who chatted. user_a is always the "smaller" id,
-- so the same two people always end up in the same row.
create table if not exists recent_contacts (
  id      bigint generated always as identity primary key,
  user_a  uuid not null references auth.users on delete cascade,
  user_b  uuid not null references auth.users on delete cascade,
  name_a  text not null,
  name_b  text not null,
  last_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
alter table recent_contacts enable row level security;

-- Both people in the pair can see and update their row
drop policy if exists "See my recent contacts" on recent_contacts;
create policy "See my recent contacts" on recent_contacts
  for select using (auth.uid() = user_a or auth.uid() = user_b);
drop policy if exists "Add my recent contacts" on recent_contacts;
create policy "Add my recent contacts" on recent_contacts
  for insert with check (auth.uid() = user_a or auth.uid() = user_b);
drop policy if exists "Update my recent contacts" on recent_contacts;
create policy "Update my recent contacts" on recent_contacts
  for update using (auth.uid() = user_a or auth.uid() = user_b)
  with check (auth.uid() = user_a or auth.uid() = user_b);
