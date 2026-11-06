-- UPDATE: speaking time (how many minutes you actually talked, per language, per day).
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN. If Supabase offers to "enable RLS" for you, run it AS WRITTEN:
-- this file already turns on Row Level Security for the new table.

-- One row per person, per day, per language, e.g. (Alex, 2026-11-05, Japanese, 754 seconds)
create table if not exists speaking_time (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  day      date not null,     -- the day in the user's own time zone
  language text not null,
  seconds  integer not null default 0,
  primary key (user_id, day, language)
);
alter table speaking_time enable row level security;

drop policy if exists "See my speaking time" on speaking_time;
create policy "See my speaking time" on speaking_time
  for select using (auth.uid() = user_id);
drop policy if exists "Add my speaking time" on speaking_time;
create policy "Add my speaking time" on speaking_time
  for insert with check (auth.uid() = user_id);
drop policy if exists "Update my speaking time" on speaking_time;
create policy "Update my speaking time" on speaking_time
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add some seconds to today's row (it's created the first time).
-- "security invoker" = it runs AS the user, so the rules above still apply.
-- At most 2 minutes per call: the server reports every 30 seconds.
create or replace function add_speaking_time(p_day date, p_language text, p_seconds integer)
returns void
language sql security invoker set search_path = public
as $$
  insert into speaking_time (user_id, day, language, seconds)
  values (auth.uid(), p_day, p_language, greatest(0, least(p_seconds, 120)))
  on conflict (user_id, day, language)
  do update set seconds = speaking_time.seconds + excluded.seconds
$$;
revoke execute on function add_speaking_time(date, text, integer) from public, anon;
grant execute on function add_speaking_time(date, text, integer) to authenticated;
