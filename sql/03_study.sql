-- UPDATE: study mode + translation reports.
-- Run this ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

-- Flashcards remember the sentence they came from, and how well you know them
alter table flashcards add column if not exists example text;                     -- e.g. "Me senté en el banco"
alter table flashcards add column if not exists status text not null default 'new'; -- new | learning | known

-- Users can tell the developers when a translation looks wrong.
-- Developers review these in Supabase: Table Editor -> translation_reports.
create table if not exists translation_reports (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null default auth.uid() references auth.users on delete cascade,
  word                  text not null,
  shown_translation     text,  -- what Speak Up showed
  suggested_translation text,  -- what the user thinks it should be
  note                  text,
  sentence              text,  -- where the word came from
  created_at            timestamptz not null default now()
);

alter table translation_reports enable row level security;

-- Users can send reports and see their own, but never other people's
create policy "Users can send reports" on translation_reports
  for insert with check (auth.uid() = user_id);
create policy "Users can see their own reports" on translation_reports
  for select using (auth.uid() = user_id);

-- TIP for developers: the most-reported words, run this in the SQL Editor any time:
--   select word, shown_translation, count(*) as reports
--   from translation_reports group by word, shown_translation order by reports desc;
