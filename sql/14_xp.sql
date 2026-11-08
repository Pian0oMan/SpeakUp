-- UPDATE: adding XP safely.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN.
--
-- Before this, the server read my XP, added to it, and saved it back. If two things gave
-- me XP at the same moment (e.g. a chat message and a minute of speaking), one of them
-- could overwrite the other, and that XP was lost. This adds the XP and updates the streak
-- in ONE step inside the database, so that can't happen.
-- The server needs this file: without it, nobody gets XP.

-- p_amount: how much XP (at most 100 at once)
-- p_today:  today's date in the user's own time zone (for the streak and daily goal)
-- Returns the new values, e.g. (xp 1250, streak 4, best_streak 9, last_active 2026-11-05, xp_today 35)
create or replace function add_xp(p_amount integer, p_today date)
returns table (xp integer, streak integer, best_streak integer, last_active date, xp_today integer)
language sql security invoker set search_path = public
as $$
  update profiles p set
    xp = p.xp + greatest(0, least(p_amount, 100)),
    -- practiced today already: same streak. Yesterday: one more day. Otherwise: start again at 1.
    streak = case when p.last_active = p_today then p.streak
                  when p.last_active = p_today - 1 then p.streak + 1
                  else 1 end,
    best_streak = greatest(p.best_streak,
                  case when p.last_active = p_today then p.streak
                       when p.last_active = p_today - 1 then p.streak + 1
                       else 1 end),
    xp_today = case when p.last_active = p_today then p.xp_today else 0 end
               + greatest(0, least(p_amount, 100)),
    last_active = p_today
  where p.id = auth.uid()
  returning p.xp, p.streak, p.best_streak, p.last_active, p.xp_today
$$;
revoke execute on function add_xp(integer, date) from public, anon;
grant execute on function add_xp(integer, date) to authenticated;
