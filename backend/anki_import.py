# ANKI IMPORT: read the cards out of an Anki deck file (.apkg).
#
# An .apkg file is secretly a ZIP file. Inside is a small SQLite database with the cards:
#   collection.anki21b  (newest Anki versions, compressed with "zstd")
#   collection.anki21   (older versions)
#   collection.anki2    (oldest versions; new versions put a dummy one in, so it's tried last)
# plus the pictures and sounds (files named 0, 1, 2...) and a "media" file that says
# which is which ("0" = "cat.jpg"). The browser shrinks the pictures and uploads them
# itself (see decks.js); here we only work out which picture belongs to which card.
#
# In the database, each "note" stores all its fields in ONE text column, separated by
# \x1f. Which field is the word and which is the meaning is different in every deck
# (field 1 can be a version number!), so we look at the deck's NOTE TYPE: the names of
# its fields ("Expression", "Meaning", "Reading"...) and which fields its cards show on
# the front and on the back.
import html
import json
import os
import re
import sqlite3
import tempfile
import zipfile

import zstandard

MAX_UNPACKED = 300 * 1024 * 1024  # refuse decks bigger than 300 MB once unpacked
MAX_CARDS = 5000
COLLECTIONS = ("collection.anki21b", "collection.anki21", "collection.anki2")

# Words in field names that tell us what a field holds, best guess first
WORD_HINTS = ["expression", "vocab", "word", "kanji", "term", "target", "front", "question", "sentence"]
MEANING_HINTS = ["meaning", "translation", "english", "definition", "gloss", "back", "answer"]
READING_HINTS = ["reading", "hiragana", "kana", "furigana", "pinyin", "pronunciation"]
EXAMPLE_HINTS = ["sentence", "example"]
NOTES_HINTS = ["notes", "note", "remarks", "explanation", "grammar", "comment"]
# Fields that are never the word or the meaning, whatever else their name says
NOT_TEXT = ["cloze", "spaced", "audio", "sound", "image", "picture", "link", "source", "version",
            "sequence", "tags", "metadata", "lookup", "id"]


class AnkiError(Exception):
    """Something is wrong with the file. The message is shown to the user."""


# ---------- TURNING ANKI'S HTML INTO PLAIN TEXT ----------
def clean_field(text):
    """Anki fields are little bits of HTML. Turn them into plain text."""
    text = re.sub(r"\[sound:[^\]]*\]", "", text)                                  # audio files
    text = re.sub(r"\{\{c\d+::(.*?)(::[^}]*)?\}\}", r"\1", text)                  # cloze {{c1::word::hint}}
    text = re.sub(r"<br\s*/?>|</?(div|p|li)[^>]*>", " ", text, flags=re.I)      # line breaks -> spaces
    text = re.sub(r"<[^>]+>", "", text)                                           # any other HTML (bold, images...)
    text = html.unescape(text)                                                    # "&amp;" -> "&", "&nbsp;" -> " "
    return re.sub(r"[\s 　]+", " ", text).strip()


def without_furigana(text):
    """Anki writes readings in brackets: " 僕[ぼく]も 寝[ね]る" -> "僕も寝る" """
    return re.sub(r"\s*([^\s\[\]]+)\[[^\]]*\]", r"\1", text).strip()


def furigana_reading(text):
    """" 僕[ぼく]も 寝[ね]る" -> "ぼくも ねる"  (None if there are no readings in brackets)"""
    if not re.search(r"\[[^\]]+\]", text):
        return None
    return re.sub(r"\s*[^\s\[\]]*?([一-鿿々]+)\[([^\]]*)\]", r"\2", text).strip()


def is_junk(text):
    """Text that can't be a word or a meaning: a number, an id, a web link."""
    return bool(re.fullmatch(r"[\d\s.,:/-]+|https?://\S+", text))


def split_first_line(raw):
    """The meaning field often has more under the meaning itself:
    "I sleep, too.<br><br>neru: to sleep" -> ("I sleep, too.", "neru: to sleep")"""
    pieces = [clean_field(piece) for piece in re.split(r"<br\s*/?>|</div>|</p>|\n", raw, flags=re.I)]
    pieces = [piece for piece in pieces if piece]
    if len(pieces) < 2:
        return clean_field(raw), None
    return pieces[0], " · ".join(pieces[1:])


# ---------- READING THE FILE ----------
def read_collection_bytes(file):
    """The card database from an .apkg file, as bytes (unpacked if it was zstd-compressed)."""
    try:
        archive = zipfile.ZipFile(file)
    except zipfile.BadZipFile:
        raise AnkiError("That doesn't look like an Anki deck (.apkg) file.")
    names = archive.namelist()
    name = next((n for n in COLLECTIONS if n in names), None)
    if not name:
        raise AnkiError("No cards found in this file.")
    if archive.getinfo(name).file_size > MAX_UNPACKED:
        raise AnkiError("This deck is too big to import.")
    return unpack(archive.read(name), name)


def unpack(data, name):
    """collection.anki21b is compressed with zstd; the older ones aren't."""
    if name.endswith("b") or data[:4] == b"\x28\xb5\x2f\xfd":  # the zstd "magic number"
        try:
            data = zstandard.ZstdDecompressor().decompress(data, max_output_size=MAX_UNPACKED)
        except zstandard.ZstdError:
            raise AnkiError("Couldn't unpack this deck. Try exporting it again from Anki.")
    if not data.startswith(b"SQLite format 3"):
        raise AnkiError("That doesn't look like an Anki deck (.apkg) file.")
    return data


def read_apkg(file):
    """A whole .apkg file -> (cards, info). See read_collection."""
    return read_collection(read_collection_bytes(file))


def read_collection(data):
    """The card database (bytes) -> (cards, info)
    cards: [{"word", "translation", "reading", "explanation", "example"}, ...]
    info:  {"notes": how many notes, "images": how many cards had a picture, "sounds": ...}"""
    # SQLite needs a real file, so write it to a temporary folder (deleted afterwards)
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "collection.db")
        with open(path, "wb") as f:
            f.write(data)
        connection = sqlite3.connect(path)
        try:
            notes = connection.execute("SELECT mid, flds FROM notes LIMIT ?", (MAX_CARDS,)).fetchall()
            note_types = read_note_types(connection)
        except sqlite3.DatabaseError:
            raise AnkiError("Couldn't read the cards in this deck.")
        finally:
            connection.close()
    if notes and len(notes) <= 1 and "update to the latest" in notes[0][1].lower():
        # Only the dummy card new Anki versions add for old ones
        raise AnkiError("This deck was made with a newer Anki. Export it again with "
                        "\"Support older Anki versions\" ticked, or update the import.")

    by_type = {}
    for note_type_id, fields in notes:
        by_type.setdefault(note_type_id, []).append(fields.split("\x1f"))

    cards, images, sounds = [], 0, 0
    for note_type_id, rows in by_type.items():
        names, front, back = note_types.get(note_type_id, ([], [], []))
        plan = choose_fields(names, front, back, rows)
        for parts in rows:
            card = make_card(parts, plan)
            if card:
                card["picture"] = first_picture(parts)  # e.g. "1600420500000.jpg", or None
                cards.append(card)
                images += card["picture"] is not None
                sounds += any("[sound:" in part for part in parts)
    if not cards:
        raise AnkiError("No cards with a front and a back found in this file.")
    return cards, {"notes": len(notes), "images": images, "sounds": sounds}


# ---------- NOTE TYPES: field names + what the cards show ----------
def read_note_types(connection):
    """{note type id: (field names, fields on the front, fields on the back)}"""
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "fields" in tables:  # newest Anki: the note types have their own tables
        types = {}
        for type_id, order, name in connection.execute("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord"):
            types.setdefault(type_id, ([], [], []))[0].append(name)
        for type_id, config in connection.execute("SELECT ntid, config FROM templates ORDER BY ntid, ord"):
            if type_id in types:
                question, answer = template_formats(config)
                types[type_id][1].extend(field_refs(question))
                types[type_id][2].extend(field_refs(answer))
        return types
    models = json.loads(connection.execute("SELECT models FROM col").fetchone()[0] or "{}")
    types = {}
    for type_id, model in models.items():
        names = [field["name"] for field in model.get("flds", [])]
        front = [ref for template in model.get("tmpls", []) for ref in field_refs(template.get("qfmt", ""))]
        back = [ref for template in model.get("tmpls", []) for ref in field_refs(template.get("afmt", ""))]
        types[int(type_id)] = (names, front, back)
    return types


def template_formats(config):
    """Newest Anki stores a card template as a tiny "protobuf" message: field 1 is the
    front's HTML, field 2 the back's. Read just those two."""
    found, i = {}, 0
    try:
        while i < len(config):
            key, i = varint(config, i)
            number, kind = key >> 3, key & 7
            if kind == 2:                       # text: a length, then the bytes
                length, i = varint(config, i)
                found[number] = config[i:i + length].decode("utf-8", "replace")
                i += length
            elif kind == 0:
                _, i = varint(config, i)
            else:
                break
    except IndexError:
        pass
    return found.get(1, ""), found.get(2, "")


def varint(data, i):
    value, shift = 0, 0
    while True:
        byte = data[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, i
        shift += 7


def field_refs(template):
    """"{{Audio}} {{furigana:Expression}} {{#Notes}}" -> ["Audio", "Expression"]"""
    refs = []
    for ref in re.findall(r"\{\{([^}]+)\}\}", template):
        if ref[:1] in "#^/!":
            continue
        name = ref.split(":")[-1].strip()
        if name not in ("FrontSide", "Tags", "Deck", "Subdeck", "Card", "Type") and name not in refs:
            refs.append(name)
    return refs


# ---------- WHICH FIELD IS WHICH ----------
def choose_fields(names, front, back, rows):
    """Pick the word, meaning, reading, example and notes fields of one note type:
    {"word": 11, "translation": 6, ...} (field positions, or None)"""
    if not names:  # no note type info: the old guess, first field = word, second = meaning
        width = max(len(parts) for parts in rows)
        names = [f"Field {i + 1}" for i in range(width)]
        front, back = names[:1], names[1:2]
    position = {name: i for i, name in enumerate(names)}

    # Fields that have real text in at least half of the notes
    def filled(i):
        with_text = sum(1 for parts in rows if i < len(parts) and (t := clean_field(parts[i])) and not is_junk(t))
        return with_text >= len(rows) / 2
    usable = [name for i, name in enumerate(names) if filled(i)]

    def textual(name):
        lower = name.lower()
        return not any(re.search(rf"(^|[^a-z]){bad}|{bad}($|[^a-z])", lower) for bad in NOT_TEXT)

    def by_hint(hints, taken, only_text=True):
        for hint in hints:
            for name in usable:
                if name not in taken and hint in name.lower() and (textual(name) or not only_text):
                    return name
        return None

    word = by_hint(WORD_HINTS, [])
    word = word or next((n for n in front if n in usable and textual(n)), None)
    word = word or next((n for n in usable if textual(n)), None) or (usable[0] if usable else None)
    taken = [word]
    meaning = by_hint(MEANING_HINTS, taken)
    meaning = meaning or next((n for n in back if n in usable and n not in front and textual(n) and n not in taken), None)
    meaning = meaning or next((n for n in usable if n not in taken and textual(n)), None)
    taken.append(meaning)
    reading = by_hint([h for h in READING_HINTS], taken, only_text=False)
    reading = reading if reading and "cloze" not in reading.lower() else None
    taken.append(reading)
    example = by_hint(EXAMPLE_HINTS, taken)
    taken.append(example)
    notes = by_hint(NOTES_HINTS, taken)
    return {key: position.get(name) for key, name in
            (("word", word), ("translation", meaning), ("reading", reading), ("example", example), ("notes", notes))}


PICTURE_TYPES = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")


def first_picture(parts):
    """The file name of the first picture on the card: <img src="cat.jpg"> -> "cat.jpg\""""
    for part in parts:
        for name in re.findall(r"<img[^>]+src=[\"']?([^\"'>]+)", part, flags=re.I):
            name = html.unescape(name).strip()
            if name.lower().endswith(PICTURE_TYPES) and "/" not in name and "\\" not in name:
                return name
    return None


def read_media_index(data):
    """The .apkg's "media" file -> {"cat.jpg": "0", ...} (picture name -> its file in the ZIP).
    Older Anki: JSON {"0": "cat.jpg"}. Newest: zstd-compressed protobuf, a list of entries
    in ZIP order (entry 0 is the file "0"), each with the name in field 1."""
    if not data:
        return {}
    if data[:4] == b"\x28\xb5\x2f\xfd":
        try:
            data = zstandard.ZstdDecompressor().decompress(data, max_output_size=50 * 1024 * 1024)
        except zstandard.ZstdError:
            return {}
        index, i = {}, 0
        try:
            while i < len(data):
                key, i = varint(data, i)
                length, i = varint(data, i)
                if key >> 3 == 1 and key & 7 == 2:
                    entry = data[i:i + length]
                    name, zip_name = message_fields(entry)
                    if name:
                        index[name] = zip_name if zip_name is not None else str(len(index))
                i += length
        except IndexError:
            pass
        return index
    try:
        return {name: number for number, name in json.loads(data.decode("utf-8")).items()}
    except (ValueError, AttributeError):
        return {}


def message_fields(entry):
    """One media entry: (name, its ZIP file name if Anki wrote one, else None)"""
    name, zip_name, i = None, None, 0
    while i < len(entry):
        key, i = varint(entry, i)
        number, kind = key >> 3, key & 7
        if kind == 2:
            length, i = varint(entry, i)
            if number == 1:
                name = entry[i:i + length].decode("utf-8", "replace")
            i += length
        elif kind == 0:
            value, i = varint(entry, i)
            if number == 255:
                zip_name = str(value)
        else:
            break
    return name, zip_name


def make_card(parts, plan):
    def raw(key):
        i = plan[key]
        return parts[i] if i is not None and i < len(parts) else ""

    word_raw = clean_field(raw("word"))
    word = without_furigana(word_raw)
    translation, more = split_first_line(raw("translation"))
    if not word or not translation or is_junk(word) or len(word) > 200:
        return None  # skip cards without a front and a back (and info cards with a whole page of text)
    reading_raw = clean_field(raw("reading"))
    reading = furigana_reading(reading_raw) or reading_raw or furigana_reading(word_raw)
    if reading and without_furigana(reading) == word:
        reading = None  # the same as the word: nothing to add
    explanation = " · ".join(text for text in (more, clean_field(raw("notes"))) if text)
    example = without_furigana(clean_field(raw("example")))
    return {
        "word": word[:200],
        "translation": translation[:500],
        "reading": reading[:200] if reading else None,
        "explanation": explanation[:1000] or None,
        "example": example[:500] if example and example != word else None,
    }
