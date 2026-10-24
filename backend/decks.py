# DECKS + FLASHCARDS: decks, cards, the word popup, pronunciation,
# the library, Anki import, and translation reports.
import os
import re

from flask import request, jsonify

from backend import dictionary
from backend.anki_import import read_apkg, AnkiError
from backend.progress import award_xp, tz_from_request
from backend.setup import app, db_for, token_from_request, fetch_all, my_profile
from backend.translation import translate_for, script_language, DEEPL_CODES


# ---------- DECKS ----------
def get_decks(db):
    """This user's decks, oldest first. Everyone gets a "My Words" deck to start."""
    try:
        rows = db.table("decks").select("id, name, color, image").order("id").execute().data
    except Exception:  # the deck-style SQL hasn't been run yet: still works, just without colors
        rows = db.table("decks").select("id, name").order("id").execute().data
    if not rows:
        rows = db.table("decks").insert({"name": "My Words"}).execute().data
    return rows


@app.route("/api/decks", methods=["GET"])
def list_decks():
    return jsonify(get_decks(db_for(token_from_request())))


@app.route("/api/decks", methods=["POST"])
def create_deck():
    name = request.get_json()["name"].strip()[:40]
    rows = db_for(token_from_request()).table("decks").insert({"name": name}).execute().data
    return jsonify(rows[0])


@app.route("/api/decks/<int:deck_id>", methods=["PATCH"])
def customize_deck(deck_id):
    """Rename a deck, or change its color or picture. e.g. {"color": "#14b8a6"}
    Sending null for color or image removes it (back to the automatic color)."""
    data = request.get_json()
    changes = {}
    if "name" in data and str(data["name"]).strip():
        changes["name"] = str(data["name"]).strip()[:40]
    if "color" in data:
        color = data["color"]
        if color is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(color)):
            return jsonify({"error": "That's not a color."}), 400
        changes["color"] = color
    if "image" in data:
        image = data["image"]
        # Only small pictures that the browser already shrank (a "data URL" of a JPEG/PNG/WebP)
        if image is not None and (not re.match(r"data:image/(jpeg|png|webp);base64,", str(image))
                                  or len(image) > 300_000):
            return jsonify({"error": "That picture can't be used."}), 400
        changes["image"] = image
    if changes:
        db_for(token_from_request()).table("decks").update(changes).eq("id", deck_id).execute()
    return jsonify({"ok": True})


@app.route("/api/decks/<int:deck_id>", methods=["DELETE"])
def delete_deck(deck_id):
    # Its cards are deleted too ("on delete cascade" in the SQL)
    db_for(token_from_request()).table("decks").delete().eq("id", deck_id).execute()
    return jsonify({"ok": True})


# ---------- FLASHCARDS ----------
@app.route("/api/translate-word", methods=["POST"])
def translate_word():
    # e.g. {"word": "banco", "sentence": "Me senté en el banco", "language": "Spanish"}
    data = request.get_json()
    person = my_profile(db_for(token_from_request()))
    translation, detected = translate_for(person, data["word"], data.get("sentence", ""),
                                          source=data.get("language"))
    language = data.get("language") or detected

    # Single words: also look them up in a real dictionary (meanings, part of speech,
    # and the base word of conjugated forms). Its definitions are in English.
    entry = None
    if person["translate_to"] == "English" and language != "English":
        # If we don't know the language for sure, try the one I'm learning, then the one I speak
        for guess in dict.fromkeys([language, person["learning"], person["native"]]):
            if guess and guess != "English":
                entry = dictionary.lookup(data["word"], guess)
                if entry:
                    language = guess
                    break
    return jsonify({"translation": translation, "language": language, "dictionary": entry})


@app.route("/api/pronounce")
def pronounce():
    """A real person saying a word (if Wiktionary has a recording), e.g. ?word=hola&language=Spanish"""
    url = dictionary.recording(request.args.get("word", ""), request.args.get("language", ""))
    return jsonify({"url": url})


@app.route("/api/flashcards", methods=["GET"])
def list_flashcards():
    db = db_for(token_from_request())
    rows = fetch_all(lambda: db.table("flashcards")
                     .select("word, color, translation, deck_id, example, status, reading, explanation, "
                             "source, language, proficiency")
                     .order("created_at"))
    return jsonify(rows)


@app.route("/api/flashcards", methods=["POST"])
def save_flashcard():
    # e.g. {"word": "banco", "color": "#ffd54f", "deck_id": 3,
    #       "sentence": "Me senté en el banco", "translation": "bench"}
    data = request.get_json()
    db = db_for(token_from_request())
    word = data["word"].lower()
    deck_id = data.get("deck_id") or get_decks(db)[0]["id"]

    existing = db.table("flashcards").select("word").eq("word", word).execute().data
    if existing:
        # Already saved: just change its color/deck (keep the translation, it may have been edited)
        db.table("flashcards").update({"color": data["color"], "deck_id": deck_id}).eq("word", word).execute()
        return jsonify({"word": word, "translation": None})

    # New card. The hover popup usually sends the translation it already showed;
    # if not, translate it now, using the sentence it came from as context.
    sentence = data.get("sentence", "")
    translation = data.get("translation")
    if not translation:
        translation, _ = translate_for(my_profile(db), word, sentence, source=data.get("language"))

    db.table("flashcards").insert({
        "word": word,
        "color": data["color"],
        "deck_id": deck_id,
        "translation": translation,
        "example": sentence or None,
        "explanation": (data.get("explanation") or "")[:300] or None,  # grammar from the dictionary
        "language": data.get("language") if data.get("language") in DEEPL_CODES else None,  # for pronunciation
    }).execute()
    award_xp(db, my_profile(db)["id"], "save_word", tz_from_request())
    return jsonify({"word": word, "translation": translation})


@app.route("/api/flashcards/<word>", methods=["PATCH"])
def edit_flashcard(word):
    # Change a card's translation, deck, or study status, e.g. {"status": "known"}
    data = request.get_json()
    changes = {key: data[key] for key in ("translation", "deck_id", "status") if key in data}
    if "proficiency" in data:  # 0 to 100, from study mode
        changes["proficiency"] = max(0, min(100, int(data["proficiency"])))
    db = db_for(token_from_request())
    db.table("flashcards").update(changes).eq("word", word.lower()).execute()
    # Studying a card earns XP (more for "Know it")
    if data.get("status") in ("known", "learning"):
        reason = "know_it" if data["status"] == "known" else "still_learning"
        award_xp(db, my_profile(db)["id"], reason, tz_from_request())
    return jsonify({"ok": True})


@app.route("/api/flashcards/<word>", methods=["DELETE"])
def delete_flashcard(word):
    db_for(token_from_request()).table("flashcards").delete().eq("word", word.lower()).execute()
    return jsonify({"ok": True})


# ---------- LIBRARY + ANKI IMPORT ----------
def add_cards(db, deck_id, cards, source, language=None):
    """Put many cards into one of my decks at once. Words that are already in one
    of my decks are skipped (each word lives in one deck). Returns (added, skipped).
    language = the language of the words (for pronunciation), if we know it."""
    have = {row["word"] for row in fetch_all(lambda: db.table("flashcards").select("word"))}
    new_rows = []
    for card in cards:
        word = card["word"].strip().lower()
        if not word or word in have:
            continue
        have.add(word)
        new_rows.append({
            "word": word,
            "deck_id": deck_id,
            "color": "#d9d2e9",  # imported words aren't highlighted in chat, so any color is fine
            "translation": card.get("translation"),
            "reading": card.get("reading"),
            "explanation": card.get("explanation"),
            "example": card.get("example"),
            "source": source,
            "language": language or card.get("language"),
        })
    for start in range(0, len(new_rows), 500):  # send them in batches of 500
        db.table("flashcards").insert(new_rows[start:start + 500]).execute()
    return len(new_rows), len(cards) - len(new_rows)


@app.route("/api/library", methods=["GET"])
def list_library():
    db = db_for(token_from_request())
    decks = db.table("library_decks").select("*").order("id").execute().data
    cards = fetch_all(lambda: db.table("library_cards").select("deck_id, word").order("id"))
    for deck in decks:
        words = [card["word"] for card in cards if card["deck_id"] == deck["id"]]
        deck["count"] = len(words)
        deck["preview"] = words[:4]  # a few example words to show on the shelf
    return jsonify(decks)


@app.route("/api/library/<int:library_id>/add", methods=["POST"])
def add_library_deck(library_id):
    """Copy a library deck into MY decks, so I can study it and track my progress."""
    db = db_for(token_from_request())
    found = db.table("library_decks").select("name, language").eq("id", library_id).execute().data
    if not found:
        return jsonify({"error": "That deck isn't in the library anymore."}), 404
    cards = fetch_all(lambda: db.table("library_cards")
                      .select("word, reading, translation, explanation, example")
                      .eq("deck_id", library_id).order("id"))
    new_deck = db.table("decks").insert({"name": found[0]["name"]}).execute().data[0]
    added, skipped = add_cards(db, new_deck["id"], cards, "library", language=found[0]["language"])
    return jsonify({"deck": new_deck, "added": added, "skipped": skipped})


@app.route("/api/import-anki", methods=["POST"])
def import_anki():
    """Upload an Anki deck (.apkg) and turn it into one of my decks."""
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "Choose an .apkg file first."}), 400
    try:
        cards = read_apkg(file.stream)
    except AnkiError as error:
        return jsonify({"error": str(error)}), 400
    name = os.path.splitext(file.filename or "")[0].strip()[:40] or "Anki deck"  # deck name = file name
    db = db_for(token_from_request())
    # Anki files don't say which language the words are in: guess from the writing
    # system (no DeepL calls for thousands of cards), or assume the language I'm learning
    learning = my_profile(db)["learning"]
    for card in cards:
        card["language"] = script_language(card["word"], learning) or learning
    new_deck = db.table("decks").insert({"name": name}).execute().data[0]
    added, skipped = add_cards(db, new_deck["id"], cards, "anki")
    return jsonify({"deck": new_deck, "added": added, "skipped": skipped})


@app.errorhandler(413)
def file_too_big(error):
    return jsonify({"error": "That file is too big (the limit is 50 MB)."}), 413


# ---------- TRANSLATION REPORTS ----------
# "This translation is wrong" -> saved for the developers to review in Supabase
@app.route("/api/reports", methods=["POST"])
def report_translation():
    data = request.get_json()
    db_for(token_from_request()).table("translation_reports").insert({
        "word": data["word"][:100],
        "shown_translation": (data.get("shown_translation") or "")[:200],
        "suggested_translation": (data.get("suggested_translation") or "")[:200],
        "note": (data.get("note") or "")[:500],
        "sentence": (data.get("sentence") or "")[:500],
    }).execute()
    return jsonify({"ok": True})
