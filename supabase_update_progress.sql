-- UPDATE: XP, levels, streaks, daily goal.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN (it only adds columns that don't exist yet).

-- xp:          all the XP ever earned (the level is calculated from it)
-- streak:      days in a row with practice
-- best_streak: the longest streak ever
-- last_active: the last day (in the user's own time zone) they earned XP
-- xp_today:    XP earned on last_active (for the daily goal)
alter table profiles add column if not exists xp integer not null default 0;
alter table profiles add column if not exists streak integer not null default 0;
alter table profiles add column if not exists best_streak integer not null default 0;
alter table profiles add column if not exists last_active date;
alter table profiles add column if not exists xp_today integer not null default 0;
