"""Builds sql/15_level_decks.sql from the word lists in this folder.

usage:  python sql/library/build.py
Then run sql/15_level_decks.sql in Supabase (SQL Editor -> New query -> paste -> Run).

The word lists are plain text, so they're easy to edit:

    @deck Japanese 1 · First Words | Japanese | English | A description of the deck.
    # Greetings                        <- a topic: it starts each card's notes
    word | reading | meaning | example | note (optional)

English lists have no reading column:   word | meaning | example | note (optional)
Cards are studied in the order they're written, so put the easy ones first.
A word that's already in an earlier deck of the same language is skipped (with a warning).
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "15_level_decks.sql"
LISTS = ["japanese.txt", "english.txt"]


def sql(text):
    """A value for the SQL file: 'text' with quotes doubled, or null."""
    return "null" if not text else "'" + text.replace("'", "''") + "'"


def read_list(path):
    decks, deck, topic, seen = [], None, "", set()
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("@deck"):
            name, language, translation_language, description = [p.strip() for p in line[5:].split("|")]
            deck = {"name": name, "language": language, "translation_language": translation_language,
                    "description": description, "cards": []}
            decks.append(deck)
            continue
        if line.startswith("#"):
            topic = line[1:].strip()
            continue
        parts = [p.strip() for p in line.split("|")]
        if deck["language"] == "Japanese":
            parts += [""] * (5 - len(parts))
            word, reading, meaning, example, note = parts[:5]
            end = ". "
        else:
            parts += [""] * (4 - len(parts))
            word, meaning, example, note = parts[:4]
            reading = ""
            end = "。"
        if not word or not meaning:
            sys.exit(f"{path.name}:{number}: a card needs a word and a meaning: {line}")
        if word.lower() in seen:
            print(f"  skipped {word} ({path.name}:{number}): it's already in an earlier card")
            continue
        seen.add(word.lower())
        explanation = topic + end.strip() + ((" " if end == ". " else "") + note if note else "")
        deck["cards"].append((word, reading, meaning, explanation, example))
    return decks


def deck_sql(deck):
    rows = ",\n".join(
        f"  ({sql(w)}, {sql(r)}, {sql(m)}, {sql(e)}, {sql(x)})" for w, r, m, e, x in deck["cards"])
    return f"""
-- {deck['name']} ({len(deck['cards'])} words)
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ({sql(deck['name'])}, {sql(deck['language'])}, {sql(deck['translation_language'])}, {sql(deck['description'])})
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, c.reading, c.translation, c.explanation, c.example
from deck, (values
{rows}
) as c(word, reading, translation, explanation, example);
"""


def main():
    decks = []
    for name in LISTS:
        found = read_list(HERE / name)
        decks += found
        print(f"{name}: {len(found)} decks, {sum(len(d['cards']) for d in found)} words")
    names = ", ".join(sql(d["name"]) for d in decks)
    OUT.write_text(f"""-- UPDATE: the level decks (Japanese 1-5 and English 1-5, about 1000 words each).
-- MADE BY sql/library/build.py from the word lists in sql/library/. Edit those, not this file.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN: it removes these decks first, then adds them again.
-- Decks people already copied into "My decks" are separate copies and stay as they are.

-- The level decks replace the old beginner decks (their words are in level 1)
delete from library_decks where name in ('Japanese for Beginners', 'English for Beginners', {names});
{''.join(deck_sql(d) for d in decks)}""", encoding="utf-8")
    print("wrote", OUT)


main()
