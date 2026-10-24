# ANKI IMPORT: read the cards out of an Anki deck file (.apkg).
#
# An .apkg file is secretly a ZIP file. Inside is a small SQLite database with the cards:
#   collection.anki21b  (newest Anki versions, compressed with "zstd")
#   collection.anki21   (older versions)
#   collection.anki2    (oldest versions)
# In the database, each "note" stores all its fields (front, back, ...) in ONE text
# column, separated by a special character: \x1f.
import html
import os
import re
import sqlite3
import tempfile
import zipfile

import zstandard

MAX_UNPACKED = 300 * 1024 * 1024  # refuse decks bigger than 300 MB once unpacked
MAX_CARDS = 5000


class AnkiError(Exception):
    """Something is wrong with the file. The message is shown to the user."""


def clean_field(text):
    """Anki fields are little bits of HTML. Turn them into plain text."""
    text = re.sub(r"\[sound:[^\]]*\]", "", text)                  # audio files
    text = re.sub(r"<br\s*/?>|</?div>", " ", text, flags=re.I)  # line breaks -> spaces
    text = re.sub(r"<[^>]+>", "", text)                           # any other HTML (bold, images...)
    text = html.unescape(text)                                    # "&amp;" -> "&", "&nbsp;" -> " "
    return re.sub(r"\s+", " ", text).strip()


def read_apkg(file):
    """Returns a list of cards: [{"word": ..., "translation": ..., "explanation": ...}, ...]"""
    try:
        archive = zipfile.ZipFile(file)
    except zipfile.BadZipFile:
        raise AnkiError("That doesn't look like an Anki deck (.apkg) file.")

    # Use the newest database inside the file
    names = archive.namelist()
    name = next((n for n in ("collection.anki21b", "collection.anki21", "collection.anki2") if n in names), None)
    if not name:
        raise AnkiError("No cards found in this file.")
    if archive.getinfo(name).file_size > MAX_UNPACKED:
        raise AnkiError("This deck is too big to import.")
    data = archive.read(name)
    if name.endswith("b"):
        data = zstandard.ZstdDecompressor().decompress(data, max_output_size=MAX_UNPACKED)

    # SQLite needs a real file, so write it to a temporary folder (deleted afterwards)
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "collection.db")
        with open(path, "wb") as f:
            f.write(data)
        connection = sqlite3.connect(path)
        try:
            rows = connection.execute("SELECT flds FROM notes LIMIT ?", (MAX_CARDS,)).fetchall()
        except sqlite3.DatabaseError:
            raise AnkiError("Couldn't read the cards in this deck.")
        finally:
            connection.close()

    # Most vocabulary decks put the word in field 1 and the meaning in field 2.
    # Fields 3 and 4 (often a reading, notes, or an example) become the explanation.
    cards = []
    for (fields,) in rows:
        parts = [clean_field(part) for part in fields.split("\x1f")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            continue  # skip cards without a front and a back
        extra = " · ".join(part for part in parts[2:4] if part)
        cards.append({
            "word": parts[0][:200],
            "translation": parts[1][:500],
            "explanation": extra[:1000] or None,
        })
    if not cards:
        raise AnkiError("No cards found in this file.")
    return cards
