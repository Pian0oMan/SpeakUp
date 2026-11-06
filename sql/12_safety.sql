-- UPDATE: blocking and reporting people.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN. If Supabase offers to "enable RLS" for you, run it AS WRITTEN:
-- this file already turns on Row Level Security for both new tables.
-- Run it AFTER 09_onboarding.sql (it updates people_to_meet() from that file).

-- ===== BLOCKS =====
-- One row per "I blocked this person". Blocked people are never matched with you,
-- stop being your friend, and disappear from your Recent list, Discover and rooms.
create table if not exists blocks (
  blocker      uuid not null default auth.uid() references auth.users on delete cascade,
  blocked      uuid not null references auth.users on delete cascade,
  blocked_name text not null default 'Someone',  -- for the "Blocked" list (profiles are private)
  created_at   timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table blocks enable row level security;

-- Only I can see, add and remove MY blocks (the blocked person never finds out)
drop policy if exists "Manage my blocks" on blocks;
create policy "Manage my blocks" on blocks
  for all using (auth.uid() = blocker) with check (auth.uid() = blocker);

-- ===== REPORTS =====
-- Developers review these in Supabase: Table Editor -> user_reports.
-- "context" is the end of the conversation, filled in by the server from what it relayed.
create table if not exists user_reports (
  id            bigint generated always as identity primary key,
  reporter      uuid not null default auth.uid() references auth.users on delete cascade,
  reported      uuid not null references auth.users on delete cascade,
  reported_name text,
  reason        text not null,  -- harassment | inappropriate | hate | spam | underage | other
  details       text,
  context       text,
  where_from    text,           -- chat | room | discover
  created_at    timestamptz not null default now()
);
alter table user_reports enable row level security;

drop policy if exists "Send reports" on user_reports;
create policy "Send reports" on user_reports
  for insert with check (auth.uid() = reporter and reporter <> reported);
drop policy if exists "See my reports" on user_reports;
create policy "See my reports" on user_reports
  for select using (auth.uid() = reporter);

-- TIP for developers: who gets reported the most, run this in the SQL Editor any time:
--   select reported, max(reported_name) as name, count(*) as reports
--   from user_reports group by reported order by reports desc;

-- ===== PEOPLE TO MEET: never suggest someone blocked (either way) =====
-- The same as in 09_onboarding.sql, plus the "blocks" check at the end.
create or replace function people_to_meet()
returns table (
  user_id uuid, username text, country text, native text, learning text,
  fluency text, interests text[], shared integer
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.country, p.native, p.learning, p.fluency, p.interests,
         cardinality(array(select unnest(p.interests) intersect select unnest(me.interests))) as shared
  from profiles p
  join profiles me on me.id = auth.uid()
  where p.id <> me.id
    and p.interests && me.interests  -- "&&" = the two lists have something in common
    and not exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id))
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker = me.id and b.blocked = p.id) or (b.blocker = p.id and b.blocked = me.id)
    )
  order by shared desc, p.last_seen desc nulls last
  limit 12
$$;
revoke execute on function people_to_meet() from public, anon;
grant execute on function people_to_meet() to authenticated;
