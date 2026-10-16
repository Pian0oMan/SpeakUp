# BACKEND: Python + Flask. It serves the website, matches chat partners,
# translates messages, and talks to the Supabase database.
import os
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO
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


# ---------- FLASHCARDS ----------
@app.route("/api/flashcards", methods=["GET"])
def list_flashcards():
    rows = db_for(token_from_request()).table("flashcards").select("word, color").execute().data
    return jsonify(rows)


@app.route("/api/flashcards", methods=["POST"])
def save_flashcard():
    data = request.get_json()  # e.g. {"word": "hola", "color": "#ffd54f"}
    # upsert = insert, or update the color if this user already saved this word
    db_for(token_from_request()).table("flashcards").upsert(
        {"word": data["word"].lower(), "color": data["color"]},
        on_conflict="user_id,word",
    ).execute()
    return jsonify({"ok": True})


@app.route("/api/flashcards/<word>", methods=["DELETE"])
def delete_flashcard(word):
    db_for(token_from_request()).table("flashcards").delete().eq("word", word.lower()).execute()
    return jsonify({"ok": True})


# ---------- TRANSLATION (DeepL) ----------
DEEPL_CODES = {
    "English": "EN-US", "Spanish": "ES", "French": "FR", "German": "DE",
    "Japanese": "JA", "Chinese": "ZH-HANS", "Russian": "RU",
}


def translate(text, language, context=""):
    """Translate text into language. Returns None if it's already in that language.
    context = the last few chat lines, so DeepL understands what's going on."""
    if not DEEPL_API_KEY:
        return None  # no key yet, so no translations
    # Free DeepL keys end in ":fx" and use a different address
    url = "https://api-free.deepl.com/v2/translate" if DEEPL_API_KEY.endswith(":fx") \
        else "https://api.deepl.com/v2/translate"
    try:
        response = requests.post(
            url,
            headers={"Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}"},
            json={
                "text": [text],
                "target_lang": DEEPL_CODES[language],
                "context": context,                         # free: not counted toward the quota
                "formality": "prefer_less",                 # casual chat tone, not textbook
                "model_type": "prefer_quality_optimized",   # DeepL's newer, smarter model
            },
            timeout=5,
        )
        response.raise_for_status()  # turns error responses (bad key, etc.) into exceptions
    except requests.RequestException as error:
        print("Translation failed:", error)
        return None
    result = response.json()["translations"][0]
    # e.g. detected "ES" and target "ES": it's already Spanish, no subtitle needed
    if DEEPL_CODES[language].startswith(result["detected_source_language"]):
        return None
    return result["text"]


# ---------- MATCHMAKING ----------
# Kept in memory (plain Python variables), not the database,
# because it only matters while people are online.
waiting = []   # people looking for a partner, e.g. {"sid": ..., "name": "Ana", "native": "Spanish", ...}
partners = {}  # sid -> that person's partner, e.g. partners["abc"] = {"sid": "xyz", "name": "Ana", ...}
histories = {} # sid -> recent chat lines, e.g. ["Alex: hey!", "Ana: hola"] (both people share one list)


def leave_current_chat(sid):
    # Take this person off the waiting list (if they were on it)
    waiting[:] = [person for person in waiting if person["sid"] != sid]
    # If they were chatting, break up the pair and tell the partner
    partner = partners.pop(sid, None)
    histories.pop(sid, None)
    if partner:
        partners.pop(partner["sid"], None)
        histories.pop(partner["sid"], None)
        socketio.emit("partner_left", to=partner["sid"])


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

    # Perfect language exchange: they speak what I'm learning,
    # and they're learning what I speak.
    for other in waiting:
        if other["native"] == me["learning"] and other["learning"] == me["native"]:
            waiting.remove(other)
            partners[me["sid"]] = other
            partners[other["sid"]] = me
            histories[me["sid"]] = histories[other["sid"]] = []  # one shared list for both
            socketio.emit("matched", other, to=me["sid"])  # tell me who I got
            socketio.emit("matched", me, to=other["sid"])  # tell them who they got
            return

    waiting.append(me)  # nobody fits yet, so wait for someone


@socketio.on("leave")
def handle_leave():
    leave_current_chat(request.sid)


# ---------- CHAT ----------
@socketio.on("chat_message")
def handle_chat_message(text):
    partner = partners.get(request.sid)
    if not partner:
        return  # not in a chat, nobody to send to
    me = partners[partner["sid"]]  # my partner's partner is me!

    # The last 6 lines of this conversation help DeepL understand slang and tone
    history = histories[request.sid]
    # (The first line describes the situation, so even the very first message has context.)
    context = "\n".join(["Casual text chat between two friends."] + history[-6:])
    history.append(f"{me['name']}: {text}")

    # Each person gets the message translated into THEIR preferred language
    for person in (me, partner):
        socketio.emit("chat_message", {
            "from": request.sid,
            "text": text,
            "translation": translate(text, person["translate_to"], context),
        }, to=person["sid"])


@socketio.on("typing")
def handle_typing():
    partner = partners.get(request.sid)
    if partner:
        socketio.emit("partner_typing", to=partner["sid"])


# Closing the tab counts as leaving
@socketio.on("disconnect")
def handle_disconnect(reason=None):
    leave_current_chat(request.sid)


if __name__ == "__main__":
    socketio.run(app, debug=True)
