-- UPDATE: friend profile cards (country, last online, words learned) + the Discover page.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN. If Supabase offers to "enable RLS" for you, run it AS WRITTEN:
-- this file already turns on Row Level Security for the new tables.

-- ===== PROFILES: two new columns =====
-- country:   where I'm from, as a 2-letter code like 'JP' or 'MX' (shown with a flag)
-- last_seen: the last time I had the app open (for "Last online 3 h ago")
alter table profiles add column if not exists country text;
alter table profiles add column if not exists last_seen timestamptz;
-- (from 06_progress.sql, repeated here so this file works even if that one was skipped)
alter table profiles add column if not exists xp integer not null default 0;
alter table profiles add column if not exists streak integer not null default 0;
alter table profiles add column if not exists last_active date;

-- ===== MY FRIENDS' CARDS =====
-- Profiles are private (you can only read your OWN row), so we can't just read a friend's
-- profile. This function is the one safe exception: "security definer" means it runs
-- with the database's rights, but it only ever returns the people who are MY friends
-- (an accepted friendship that I'm part of), and only these few public-ish fields.
create or replace function friend_cards()
returns table (
  user_id uuid, country text, native text, learning text,
  xp integer, streak integer, last_active date, last_seen timestamptz, words_learned bigint
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.country, p.native, p.learning, p.xp, p.streak, p.last_active, p.last_seen,
         (select count(*) from flashcards f where f.user_id = p.id and f.status = 'known')
  from profiles p
  where p.id in (
    select case when requester = auth.uid() then addressee else requester end
    from friendships
    where status = 'accepted' and auth.uid() in (requester, addressee)
  )
$$;
-- Only logged-in users may call it (not anonymous visitors)
revoke execute on function friend_cards() from public, anon;
grant execute on function friend_cards() to authenticated;

-- ===== DISCOVER: posts =====
-- One row per post. The author's name, country and languages are copied into the post,
-- because other people can't read the author's profile.
-- stats: an optional progress card, e.g. {"level": 6, "streak": 12, "words": 142}
create table if not exists posts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null,
  country     text,
  native      text,
  learning    text,
  body        text not null check (char_length(body) between 1 and 500),
  stats       jsonb,
  created_at  timestamptz not null default now()
);
alter table posts enable row level security;

-- Everyone who's logged in can read every post
drop policy if exists "Logged-in users read posts" on posts;
create policy "Logged-in users read posts" on posts
  for select to authenticated using (true);
-- You can only post as yourself
drop policy if exists "Post as myself" on posts;
create policy "Post as myself" on posts
  for insert to authenticated with check (auth.uid() = user_id);
-- You can only delete your own posts
drop policy if exists "Delete my posts" on posts;
create policy "Delete my posts" on posts
  for delete using (auth.uid() = user_id);

-- ===== DISCOVER: cheers (likes) =====
-- One row per (post, person who cheered). The primary key stops cheering twice.
create table if not exists cheers (
  post_id bigint not null references posts on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (post_id, user_id)
);
alter table cheers enable row level security;

drop policy if exists "Logged-in users see cheers" on cheers;
create policy "Logged-in users see cheers" on cheers
  for select to authenticated using (true);
drop policy if exists "Cheer as myself" on cheers;
create policy "Cheer as myself" on cheers
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Take back my cheer" on cheers;
create policy "Take back my cheer" on cheers
  for delete using (auth.uid() = user_id);
