-- UPDATE: multiple decks + translations.
-- Run this ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It keeps all existing flashcards and moves them into a deck called "My Words".

-- A deck belongs to one user and holds many flashcards
create table if not exists decks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table decks enable row level security;

create policy "Users manage their own decks" on decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Flashcards get a translation, a deck, and the date they were saved.
-- "on delete cascade": deleting a deck deletes its cards too.
alter table flashcards add column if not exists translation text;
alter table flashcards add column if not exists deck_id bigint references decks on delete cascade;
alter table flashcards add column if not exists created_at timestamptz not null default now();

-- Give everyone who already has flashcards a "My Words" deck...
insert into decks (user_id, name)
select distinct user_id, 'My Words' from flashcards
where user_id not in (select user_id from decks);

-- ...and put their existing cards into it
update flashcards f
set deck_id = d.id
from decks d
where d.user_id = f.user_id and f.deck_id is null;
