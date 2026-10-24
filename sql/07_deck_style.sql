-- UPDATE: deck colors + pictures.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN (it only adds columns that don't exist yet).

-- color: a color the user picked for the deck, e.g. '#14b8a6' (empty = automatic color)
-- image: a small picture for the deck. The browser shrinks it to a 160x160 JPEG first,
--        then it's stored right here as text (a "data URL"), so no file storage is needed.
alter table decks add column if not exists color text;
alter table decks add column if not exists image text;
