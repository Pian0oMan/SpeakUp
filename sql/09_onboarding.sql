-- UPDATE: the welcome questions (level, how long you've studied, interests)
-- and "People to meet" on the Discover page.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run 08_friends_discover.sql FIRST. This file is SAFE TO RUN AGAIN.

-- ===== PROFILES: three new columns =====
-- fluency:      how well I speak the language I'm learning:
--               'beginner' | 'elementary' | 'intermediate' | 'advanced'
-- studying_for: how long I've been learning it:
--               'just_started' | 'under_6_months' | '6_to_12_months' | '1_to_3_years' | 'over_3_years'
-- interests:    a list of topics, e.g. {anime,music,travel}
alter table profiles add column if not exists fluency text;
alter table profiles add column if not exists studying_for text;
alter table profiles add column if not exists interests text[] not null default '{}';

-- Posts remember the author's level + interests too (like their name and country)
alter table posts add column if not exists fluency text;
alter table posts add column if not exists interests text[] not null default '{}';

-- ===== MY FRIENDS' CARDS, now with level + interests =====
-- (Changing what a function returns means dropping the old one first)
drop function if exists friend_cards();
create function friend_cards()
returns table (
  user_id uuid, country text, native text, learning text, fluency text, interests text[],
  xp integer, streak integer, last_active date, last_seen timestamptz, words_learned bigint
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.country, p.native, p.learning, p.fluency, p.interests,
         p.xp, p.streak, p.last_active, p.last_seen,
         (select count(*) from flashcards f where f.user_id = p.id and f.status = 'known')
  from profiles p
  where p.id in (
    select case when requester = auth.uid() then addressee else requester end
    from friendships
    where status = 'accepted' and auth.uid() in (requester, addressee)
  )
$$;
revoke execute on function friend_cards() from public, anon;
grant execute on function friend_cards() to authenticated;

-- ===== PEOPLE TO MEET =====
-- Up to 12 people who share at least one interest with me and aren't my friends yet,
-- most shared interests first, then the most recently online.
-- Like friend_cards(), it runs with the database's rights, so it only returns
-- these "business card" fields: never emails, XP details or anything else.
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
  order by shared desc, p.last_seen desc nulls last
  limit 12
$$;
revoke execute on function people_to_meet() from public, anon;
grant execute on function people_to_meet() to authenticated;
