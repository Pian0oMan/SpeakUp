-- UPDATE: spaced repetition (each card comes back right before you'd forget it).
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN (it only adds what doesn't exist yet).
-- How the schedule is worked out: see backend/review.py

-- due_at:           when the card should be reviewed next (empty = a new card, never studied)
-- interval_days:    days between reviews. It grows every time you remember the card.
-- ease:             how easy the card is for you (2.5 = normal). Hard cards grow more slowly.
-- reps:             how many times in a row you remembered it
-- lapses:           how many times you forgot it after knowing it
-- first_studied_at: when you first studied it (to only add a few NEW cards per day)
alter table flashcards add column if not exists due_at timestamptz;
alter table flashcards add column if not exists interval_days real not null default 0;
alter table flashcards add column if not exists ease real not null default 2.5;
alter table flashcards add column if not exists reps integer not null default 0;
alter table flashcards add column if not exists lapses integer not null default 0;
alter table flashcards add column if not exists first_studied_at timestamptz;

-- Cards studied before this update keep counting as studied: they're due for a review now.
-- (Only cards that were never scheduled, so running this again changes nothing.)
update flashcards
set due_at = now(), reps = 1, interval_days = 1, first_studied_at = created_at
where due_at is null and status <> 'new';

-- Finding "my cards that are due" quickly, even with thousands of cards
create index if not exists flashcards_due on flashcards (user_id, due_at);
