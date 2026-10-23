# BACKEND: Python + Flask. It serves the website, matches chat partners,
# translates messages, and talks to the Supabase database.
import os
import random
import re
from functools import lru_cache
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room
from supabase import create_client

# SETTINGS: read the secret keys from the .env file
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
DEEPL_API_KEY = os.getenv("DEEPL_API_KEY")
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise SystemExit("Fill in SUPABASE_URL and SUPABASE_ANON_KEY in the .env file first!")

app = Flask(__name__, static_folder="static")
socketio = SocketIO(app)  # adds real-time "always open" connections


# DATABASE: a Supabase connection that acts AS the logged-in user.
# The token proves who they are, and the security rules in supabase_setup.sql
# make sure they can only touch their own rows.
def db_for(token):
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def token_from_request():
    # The browser sends:  Authorization: Bearer <token>
    return request.headers.get("Authorization", "").removeprefix("Bearer ")


# Visiting http://localhost:5000/ sends the HTML page
@app.route("/")
def home():
    return send_from_directory("static", "index.html")


# The browser needs these two values to log in with Supabase.
# (The anon key is safe to share: the security rules protect the data.)
@app.route("/api/config")
def config():
    return jsonify({"url": SUPABASE_URL, "anonKey": SUPABASE_ANON_KEY})


# ---------- PROFILE ----------
@app.route("/api/profile", methods=["GET"])
def get_profile():
    rows = db_for(token_from_request()).table("profiles").select("*").execute().data
    return jsonify(rows[0] if rows else None)  # None = hasn't set up a profile yet


@app.route("/api/profile", methods=["PUT"])
def save_profile():
    data = request.get_json()
    db_for(token_from_request()).table("profiles").upsert({
        "username": data["username"],
        "native": data["native"],
        "learning": data["learning"],
        "translate_to": data["translate_to"],
    }).execute()
    return jsonify({"ok": True})


# ---------- DECKS ----------
def get_decks(db):
    """This user's decks, oldest first. Everyone gets a "My Words" deck to start."""
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


@app.route("/api/decks/<int:deck_id>", methods=["DELETE"])
def delete_deck(deck_id):
    # Its cards are deleted too ("on delete cascade" in the SQL)
    db_for(token_from_request()).table("decks").delete().eq("id", deck_id).execute()
    return jsonify({"ok": True})


# ---------- FLASHCARDS ----------
def my_profile(db):
    return db.table("profiles").select("*").execute().data[0]


# Hovering over a word: a short translation + the language it's in
@app.route("/api/translate-word", methods=["POST"])
def translate_word():
    # e.g. {"word": "banco", "sentence": "Me senté en el banco", "language": "Spanish"}
    data = request.get_json()
    person = my_profile(db_for(token_from_request()))
    translation, detected = translate_for(person, data["word"], data.get("sentence", ""),
                                          source=data.get("language"))
    return jsonify({"translation": translation, "language": data.get("language") or detected})


@app.route("/api/flashcards", methods=["GET"])
def list_flashcards():
    rows = (db_for(token_from_request()).table("flashcards")
            .select("word, color, translation, deck_id, example, status").order("created_at").execute().data)
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
    }).execute()
    return jsonify({"word": word, "translation": translation})


@app.route("/api/flashcards/<word>", methods=["PATCH"])
def edit_flashcard(word):
    # Change a card's translation, deck, or study status, e.g. {"status": "known"}
    data = request.get_json()
    changes = {key: data[key] for key in ("translation", "deck_id", "status") if key in data}
    db_for(token_from_request()).table("flashcards").update(changes).eq("word", word.lower()).execute()
    return jsonify({"ok": True})


@app.route("/api/flashcards/<word>", methods=["DELETE"])
def delete_flashcard(word):
    db_for(token_from_request()).table("flashcards").delete().eq("word", word.lower()).execute()
    return jsonify({"ok": True})


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


# ---------- TRANSLATION (DeepL) ----------
DEEPL_CODES = {
    "English": "EN-US", "Spanish": "ES", "French": "FR", "German": "DE",
    "Japanese": "JA", "Chinese": "ZH-HANS", "Russian": "RU",
}


# The codes DeepL uses for the language it DETECTS, e.g. "JA" -> "Japanese"
DEEPL_NAMES = {"EN": "English", "ES": "Spanish", "FR": "French", "DE": "German",
               "JA": "Japanese", "ZH": "Chinese", "RU": "Russian"}
SOURCE_CODES = {name: code for code, name in DEEPL_NAMES.items()}  # "Japanese" -> "JA"
# Other languages DeepL might DETECT (we can't match people in these yet, but we can name them)
DEEPL_NAMES.update({"PT": "Portuguese", "IT": "Italian", "NL": "Dutch", "PL": "Polish",
                    "SV": "Swedish", "KO": "Korean", "TR": "Turkish", "UK": "Ukrainian"})


def translate_detail(text, language, context="", source=None):
    """Translate text into language.
    Returns (translation, detected language name). translation is None if the
    text is already in that language.
    context = nearby text (chat lines or the sentence), so DeepL picks the right meaning.
    source  = the language the text is in, if we already know it (more accurate for single words)."""
    if not DEEPL_API_KEY:
        return None, None  # no key yet, so no translations
    if source == language:
        return None, source  # already in that language, no need to ask DeepL
    # Free DeepL keys end in ":fx" and use a different address
    url = "https://api-free.deepl.com/v2/translate" if DEEPL_API_KEY.endswith(":fx") \
        else "https://api.deepl.com/v2/translate"
    body = {
        "text": [text],
        "target_lang": DEEPL_CODES[language],
        "context": context,                         # free: not counted toward the quota
        "formality": "prefer_less",                 # casual chat tone, not textbook
        "model_type": "prefer_quality_optimized",   # DeepL's newer, smarter model
    }
    if source in SOURCE_CODES:
        body["source_lang"] = SOURCE_CODES[source]
    try:
        response = requests.post(url, headers={"Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}"},
                                 json=body, timeout=5)
        response.raise_for_status()  # turns error responses (bad key, etc.) into exceptions
    except requests.RequestException as error:
        print("Translation failed:", error)
        return None, None
    result = response.json()["translations"][0]
    detected = DEEPL_NAMES.get(result["detected_source_language"], result["detected_source_language"])
    # e.g. detected "ES" and target "ES": it's already Spanish, no subtitle needed
    if DEEPL_CODES[language].startswith(result["detected_source_language"]):
        return None, detected
    # Got the same text back: it was already in that language. (DeepL sometimes
    # guesses wrong on short messages, e.g. it thinks "I love ramen" is Swedish.)
    if result["text"].strip().lower() == text.strip().lower():
        return None, language
    return result["text"], detected


LATIN_SCRIPT = {"English", "Spanish", "French", "German"}  # languages written with a, b, c...


def detect_language(text, sender, context=""):
    """Which language is a chat message in? It's almost always one of the sender's
    two languages, and the writing system usually tells us which one."""
    pair = [sender["native"], sender["learning"]]
    if re.search(r"[぀-ヿ]", text):        # hiragana / katakana
        return "Japanese"
    if re.search(r"[Ѐ-ӿ]", text):        # Cyrillic
        return "Russian"
    if re.search(r"[一-鿿]", text):        # Chinese characters (Japanese uses them too)
        return "Japanese" if "Japanese" in pair else "Chinese"
    latin = [language for language in pair if language in LATIN_SCRIPT]
    if len(latin) == 1:                            # e.g. English <-> Japanese: a, b, c means English
        return latin[0]
    # Both languages use a, b, c (e.g. English <-> Spanish): ask DeepL, but only
    # trust its answer if it's one of the sender's languages. Unknown beats wrong.
    target = next(language for language in DEEPL_CODES if language not in pair)
    _, detected = translate_detail(text, target, context)
    return detected if detected in pair else None


def translate(text, language, context=""):
    """Like translate_detail, but only returns the translation."""
    return translate_detail(text, language, context)[0]


def translate_for(person, text, context="", source=None):
    """Translate for one person: into their translation language. If the text is
    ALREADY in that language, try the language they're learning ("how to say it"),
    and then the language they speak (in case their settings point to the same language)."""
    detected = None
    tried = []
    for language in (person["translate_to"], person["learning"], person.get("native")):
        if not language or language in tried:
            continue
        tried.append(language)
        translation, found = translate_detail(text, language, context, source)
        detected = detected or found
        if translation:
            return translation, detected
    return None, detected


# ---------- MATCHMAKING ----------
# Kept in memory (plain Python variables), not the database,
# because it only matters while people are online.
waiting = []   # people looking for a partner, e.g. {"sid": ..., "name": "Ana", "native": "Spanish", ...}
partners = {}  # sid -> that person's partner, e.g. partners["abc"] = {"sid": "xyz", "name": "Ana", ...}
chats = {}     # sid -> the chat they're in. Both people point to the SAME chat, e.g.
               # {"history": ["Alex: hey!"], "question": "...", "answered": {"abc"}, "active": True}


def leave_current_chat(sid):
    # Take this person off the waiting list (if they were on it)
    waiting[:] = [person for person in waiting if person["sid"] != sid]
    # If they were chatting, end the chat, break up the pair, and tell the partner
    chat = chats.pop(sid, None)
    if chat:
        chat["active"] = False  # this stops the icebreaker timer
    partner = partners.pop(sid, None)
    if partner:
        partners.pop(partner["sid"], None)
        chats.pop(partner["sid"], None)
        socketio.emit("partner_left", to=partner["sid"])


# ---------- ICEBREAKERS ----------
ICEBREAKER_SECONDS = 360  # how often a new question appears

ICEBREAKERS = [
    "What is your favorite food?",
    "What do you like to do on weekends?",
    "What is a movie or show you love?",
    "If you could visit any country, where would you go?",
    "What music are you listening to lately?",
    "What is the best thing that happened to you this week?",
    "Do you have any pets? Tell me about them.",
    "What is a food from your country that I should try?",
    "What did you want to be when you were a kid?",
    "What is your favorite season, and why?",
    "What is a hobby you would like to start?",
    "What is something people in your country do that might surprise me?",
    "Are you a morning person or a night person?",
    "What is the last thing that made you laugh?",
    "Why are you learning a new language?",
    "What is your dream job?",
    "What would you do with a free day and no plans?",
    "What is a word in your language that is hard to translate?",
]


@lru_cache(maxsize=None)  # remembers results, so each question is only translated once per language
def in_language(text, language):
    """The icebreakers are written in English. This returns one in any language."""
    if language == "English":
        return text
    return translate(text, language) or text


def send_icebreaker(chat):
    question = chat["questions"].pop()
    chat["question"] = question
    chat["answered"] = set()
    for person in chat["people"]:
        # Shown in the language they're learning. Hover over words for help.
        socketio.emit("icebreaker", {
            "question": in_language(question, person["learning"]),
            "language": person["learning"],
            "next_in": ICEBREAKER_SECONDS,
        }, to=person["sid"])


def icebreaker_timer(chat):
    # Runs in the background for as long as the chat lasts
    while chat["active"] and chat["questions"]:
        send_icebreaker(chat)
        socketio.sleep(ICEBREAKER_SECONDS)


@socketio.on("find_partner")
def find_partner(data):
    # Look up WHO this is from their login token (we don't just trust the browser)
    rows = db_for(data["token"]).table("profiles").select("*").execute().data
    if not rows:
        return
    profile = rows[0]
    me = {
        "sid": request.sid,  # unique id for this browser's connection
        "name": profile["username"],
        "native": profile["native"],
        "learning": profile["learning"],
        "translate_to": profile["translate_to"],
    }
    leave_current_chat(request.sid)  # in case they clicked "Next"
    exit_room(request.sid)           # or they were in a voice room

    # Perfect language exchange: they speak what I'm learning,
    # and they're learning what I speak.
    for other in waiting:
        if other["native"] == me["learning"] and other["learning"] == me["native"]:
            waiting.remove(other)
            partners[me["sid"]] = other
            partners[other["sid"]] = me
            chat = {
                "people": [me, other],
                "history": [],
                "questions": random.sample(ICEBREAKERS, len(ICEBREAKERS)),  # shuffled, no repeats
                "question": None,
                "answered": set(),
                "active": True,
            }
            chats[me["sid"]] = chats[other["sid"]] = chat  # one shared chat for both
            # Tell each person who they got. ONE of them ("initiator") starts the
            # video connection, otherwise both browsers would try at the same time.
            socketio.emit("matched", {**other, "initiator": True}, to=me["sid"])
            socketio.emit("matched", {**me, "initiator": False}, to=other["sid"])
            socketio.start_background_task(icebreaker_timer, chat)
            return

    waiting.append(me)  # nobody fits yet, so wait for someone


@socketio.on("leave")
def handle_leave():
    leave_current_chat(request.sid)


# ---------- CHAT ----------
@socketio.on("chat_message")
def handle_chat_message(text):
    send_chat_message(request.sid, text)


def send_chat_message(sid, text, voice=False, language=None):
    """Send a message from sid to their partner (and back to them).
    voice=True means it was spoken in the call (a finished live caption)."""
    partner = partners.get(sid)
    if not partner:
        return  # not in a chat, nobody to send to
    me = partners[partner["sid"]]  # my partner's partner is me!

    chat = chats[sid]

    # The last 6 lines of this conversation help DeepL understand slang and tone
    history = chat["history"]
    # (The first line describes the situation, so even the very first message has context.)
    context = "\n".join(["Casual text chat between two friends."] + history[-6:])
    history.append(f"{me['name']}: {text}")

    # My first message after an icebreaker counts as my answer (spoken ones too!)
    is_answer = chat["question"] is not None and sid not in chat["answered"]
    if is_answer:
        chat["answered"].add(sid)

    # Messages are NOT translated automatically: people hover over words to translate
    # them. We only find out which language the message is IN. The word popup shows
    # it, and it makes single-word translations much more accurate.
    # (For speech we already know: it's the language the speech recognizer listened for.)
    language = language or detect_language(text, me, context)
    for person in (me, partner):
        socketio.emit("chat_message", {
            "from": sid,
            "text": text,
            "language": language,
            "answer": is_answer,
            "voice": voice,
        }, to=person["sid"])

    if is_answer:  # update the ✅ / ⏳ on the question card for both people
        for person in (me, partner):
            socketio.emit("icebreaker_answered", list(chat["answered"]), to=person["sid"])


# ---------- LIVE CAPTIONS ----------
# While someone talks, their browser turns speech into text and sends it here,
# e.g. {"text": "ラーメンが好き", "final": False, "language": "Japanese"}.
# "final" = they finished the sentence; then it's also added to the chat.
@socketio.on("caption")
def handle_caption(data):
    text = str(data.get("text", "")).strip()[:500]
    language = data.get("language") if data.get("language") in DEEPL_CODES else None
    if not text:
        return

    # In a voice room: everyone else in the room sees it under my name
    room_id = room_of.get(request.sid)
    if room_id:
        socketio.emit("room_caption", {"sid": request.sid, "text": text, "language": language},
                      to=f"room:{room_id}", skip_sid=request.sid)
        if data.get("final"):
            send_room_message(request.sid, text, voice=True, language=language)
        return

    # In a 1-on-1 chat: my partner sees it over my video
    partner = partners.get(request.sid)
    if not partner:
        return
    socketio.emit("caption", {"text": text, "language": language}, to=partner["sid"])
    if data.get("final"):
        send_chat_message(request.sid, text, voice=True, language=language)


@socketio.on("typing")
def handle_typing():
    partner = partners.get(request.sid)
    if partner:
        socketio.emit("partner_typing", to=partner["sid"])


# ---------- VIDEO CALLS ----------
# The video and audio go DIRECTLY between the two browsers (WebRTC).
# The server only passes small "call" messages between them so they can
# find each other: invite, accept, decline, offer, answer, candidate, end.
@socketio.on("call")
def relay_call(data):
    partner = partners.get(request.sid)
    if partner:
        socketio.emit("call", data, to=partner["sid"])


# ---------- VOICE ROOMS ----------
# Group voice chats (3 to 10 people) with a side chat. Kept in memory, like matchmaking.
# Everyone in a room connects DIRECTLY to everyone else for audio (WebRTC);
# the server only passes the small connection messages between them.
rooms = {}    # room id -> room, e.g. {"id": "r1", "name": "Spanish for Beginners", "language": "Spanish",
              #   "max_size": 6, "host": "Ana", "members": {sid: person}, "history": [...], "permanent": False}
room_of = {}  # sid -> id of the room they're in
room_counter = [0]


def add_room(name, language, max_size, host, permanent=False):
    room_counter[0] += 1
    room_id = f"r{room_counter[0]}"
    rooms[room_id] = {"id": room_id, "name": name, "language": language, "max_size": max_size,
                      "host": host, "members": {}, "history": [], "permanent": permanent}
    return rooms[room_id]


# Test rooms that are always there (permanent = not deleted when everyone leaves)
add_room("English Café", "English", 10, "Speak Up", permanent=True)
add_room("日本語でおしゃべり (Japanese chat)", "Japanese", 8, "Speak Up", permanent=True)
add_room("Spanish for Beginners", "Spanish", 6, "Speak Up", permanent=True)
add_room("Anime & Manga Talk", "Japanese", 10, "Speak Up", permanent=True)


def room_summary(room):
    """What the room list shows (not the members' private details)."""
    return {"id": room["id"], "name": room["name"], "language": room["language"],
            "max_size": room["max_size"], "host": room["host"], "count": len(room["members"])}


def broadcast_rooms():
    socketio.emit("rooms", [room_summary(room) for room in rooms.values()])  # to everyone online


def public_info(person):
    return {key: person[key] for key in ("sid", "name", "native", "learning")}


def person_from_token(token):
    """Who is this? Looked up from their login token, like in find_partner."""
    rows = db_for(token).table("profiles").select("*").execute().data
    if not rows:
        return None
    profile = rows[0]
    return {"sid": request.sid, "name": profile["username"], "native": profile["native"],
            "learning": profile["learning"], "translate_to": profile["translate_to"]}


@socketio.on("list_rooms")
def list_rooms():
    socketio.emit("rooms", [room_summary(room) for room in rooms.values()], to=request.sid)


@socketio.on("create_room")
def create_room(data):
    name = str(data.get("name", "")).strip()[:40]
    language = data.get("language")
    try:
        max_size = int(data.get("max_size", 10))
    except (TypeError, ValueError):
        max_size = 10
    max_size = min(10, max(3, max_size))  # always between 3 and 10
    person = person_from_token(data.get("token"))
    if not name or language not in DEEPL_CODES or not person:
        socketio.emit("room_error", "Give the room a name and a language.", to=request.sid)
        return
    enter_room(add_room(name, language, max_size, person["name"]), person)


@socketio.on("join_room")
def handle_join_room(data):
    room = rooms.get(data.get("room_id"))
    person = person_from_token(data.get("token"))
    if not room or not person:
        socketio.emit("room_error", "This room doesn't exist anymore.", to=request.sid)
    elif len(room["members"]) >= room["max_size"] and request.sid not in room["members"]:
        socketio.emit("room_error", "This room is full.", to=request.sid)
    else:
        enter_room(room, person)


def enter_room(room, person):
    sid = person["sid"]
    if room_of.get(sid) == room["id"]:
        return  # already in this room
    leave_current_chat(sid)  # leave any 1-on-1 chat or search...
    exit_room(sid)           # ...and any other room
    others = [public_info(member) for member in room["members"].values()]
    room["members"][sid] = person
    room_of[sid] = room["id"]
    join_room(f"room:{room['id']}", sid=sid)  # a Socket.IO "room" = a group we can send to at once
    socketio.emit("room_joined", {"room": room_summary(room), "members": others,
                                  "history": room["history"][-50:]}, to=sid)
    socketio.emit("room_member_joined", public_info(person), to=f"room:{room['id']}", skip_sid=sid)
    broadcast_rooms()


def exit_room(sid):
    room = rooms.get(room_of.pop(sid, None))
    if not room:
        return
    room["members"].pop(sid, None)
    leave_room(f"room:{room['id']}", sid=sid)
    socketio.emit("room_member_left", sid, to=f"room:{room['id']}")
    if not room["members"] and not room["permanent"]:
        del rooms[room["id"]]  # the last person left a user-made room: it's gone
    broadcast_rooms()


@socketio.on("leave_room")
def handle_leave_room():
    exit_room(request.sid)


@socketio.on("room_message")
def handle_room_message(text):
    send_room_message(request.sid, str(text)[:1000])


def send_room_message(sid, text, voice=False, language=None):
    room = rooms.get(room_of.get(sid))
    if not room or not text.strip():
        return
    person = room["members"][sid]
    msg = {"from": sid, "name": person["name"], "text": text, "voice": voice,
           "language": language or detect_language(text, person)}
    room["history"].append(msg)
    del room["history"][:-50]  # keep only the last 50 messages
    socketio.emit("room_message", msg, to=f"room:{room['id']}")


# Connection messages between two people in the same room (offer, answer, candidate)
@socketio.on("room_signal")
def relay_room_signal(data):
    target = data.get("to")
    if room_of.get(request.sid) and room_of.get(request.sid) == room_of.get(target):
        socketio.emit("room_signal", {"from": request.sid, "data": data.get("data")}, to=target)


# Mic on/off, so everyone can see who's muted
@socketio.on("room_media")
def relay_room_media(data):
    room_id = room_of.get(request.sid)
    if room_id:
        socketio.emit("room_media", {"sid": request.sid, "mic": bool(data.get("mic"))},
                      to=f"room:{room_id}", skip_sid=request.sid)


# Closing the tab counts as leaving
@socketio.on("disconnect")
def handle_disconnect(reason=None):
    leave_current_chat(request.sid)
    exit_room(request.sid)


if __name__ == "__main__":
    socketio.run(app, debug=True)
