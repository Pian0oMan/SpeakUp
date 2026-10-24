-- Run this ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It creates our two tables and the security rules for them.

-- Each user's profile. "id" is the same id Supabase gives the user when they sign up.
create table if not exists profiles (
  id           uuid primary key default auth.uid() references auth.users on delete cascade,
  username     text not null,
  native       text not null,  -- language I speak
  learning     text not null,  -- language I'm learning
  translate_to text not null   -- language I want translations shown in
);

-- Flashcards. Every card belongs to one user (user_id).
create table if not exists flashcards (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  word    text not null,
  color   text not null,
  unique (user_id, word)  -- the same user can't save the same word twice
);

-- ROW LEVEL SECURITY: the database itself makes sure
-- people can only see and change THEIR OWN rows.
alter table profiles   enable row level security;
alter table flashcards enable row level security;

create policy "Users manage their own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users manage their own flashcards" on flashcards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
