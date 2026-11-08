# Database setup (Supabase)

These files build Speak Up's database. Run them **in order**, in Supabase:
**Dashboard → SQL Editor → New query → paste → Run**.

**Run all of them.** The server expects every table and function below to be there.

| File | What it adds |
|---|---|
| `01_setup.sql` | Profiles and flashcards, with security rules (each user only sees their own rows) |
| `02_decks.sql` | Multiple decks, and translations on cards |
| `03_study.sql` | Study mode (example sentences, study status) and translation reports |
| `04_library.sql` | The shared deck library with 3 beginner decks, readings, explanations, pronunciation language, proficiency |
| `05_friends.sql` | Friends and recent contacts |
| `06_progress.sql` | XP, levels, streaks, daily goal |
| `07_deck_style.sql` | Deck colors and pictures |
| `08_friends_discover.sql` | Countries, "last online", friends' stats, and the Discover page (posts + cheers) |
| `09_onboarding.sql` | The welcome questions (level, how long you've studied, interests) and "People to meet" |
| `10_review.sql` | Spaced repetition: when each card is due, and how fast its interval grows |
| `11_speaking.sql` | Speaking time: minutes you talked, per language, per day |
| `12_safety.sql` | Blocking and reporting people (and "People to meet" skips blocked people) |
| `13_card_images.sql` | Pictures on flashcards from Anki decks (a Storage bucket, shrunk pictures only) |
| `14_xp.sql` | Adding XP in one safe step (so XP earned at the same moment isn't lost) |

Files 04 to 14 are safe to run again. If Supabase offers to "enable RLS" for you,
run the file as written: every file already turns on Row Level Security itself.
