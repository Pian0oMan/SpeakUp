# SETUP: what every other file needs: the settings from .env, the Flask app,
# Socket.IO, the Supabase database connection, and "who is this?" helpers.
import os
import threading
from collections import OrderedDict

from dotenv import load_dotenv
from flask import Flask, request
from flask_socketio import SocketIO
from supabase import create_client


# SETTINGS: read the secret keys from the .env file
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
DEEPL_API_KEY = os.getenv("DEEPL_API_KEY")
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise SystemExit("Fill in SUPABASE_URL and SUPABASE_ANON_KEY in the .env file first!")

# Optional: a TURN server for calls. Most calls connect browser-to-browser directly, but
# strict networks (schools, offices, some phone networks) block that. A TURN server then
# passes the call along. Several addresses can be listed, separated by commas (see README.md).
TURN_URLS = [url.strip() for url in os.getenv("TURN_URLS", "").split(",") if url.strip()]
TURN_USERNAME = os.getenv("TURN_USERNAME", "")
TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL", "")

# This file is in speakup/backend/, the website files are in speakup/static/
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=os.path.join(ROOT, "static"))
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # uploads (Anki decks) up to 50 MB
socketio = SocketIO(app)  # adds real-time "always open" connections


# DATABASE: a Supabase connection that acts AS the logged-in user.
# The token proves who they are, and the security rules in sql/01_setup.sql
# make sure they can only touch their own rows.
#
# Making a new connection takes almost half a second, so each login token's connection
# is kept and reused (only the most recent ones: tokens change every hour anyway).
CLIENTS_KEPT = 500
clients = OrderedDict()  # login token -> its database connection, least recently used first
clients_lock = threading.Lock()


def db_for(token):
    with clients_lock:
        client = clients.get(token)
        if client:
            clients.move_to_end(token)  # just used: keep it longest
            return client
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)  # (slow, so not while holding the lock)
    client.postgrest.auth(token)
    with clients_lock:
        clients[token] = client
        while len(clients) > CLIENTS_KEPT:
            clients.popitem(last=False)  # forget the one unused the longest
    return client


# Login tokens expire every hour, and the browser then sends its new one ("hello" in
# social.py). People in a chat or voice room were looked up when they joined, so the
# token saved with them gets old. db_as() always uses the newest one.
latest_token = {}  # sid -> the newest login token of that connection


def db_as(person):
    """A database connection as someone who's online (e.g. my chat partner, or a room member)."""
    return db_for(latest_token.get(person["sid"]) or person["token"])


def token_from_request():
    # The browser sends:  Authorization: Bearer <token>
    return request.headers.get("Authorization", "").removeprefix("Bearer ")


def fetch_all(make_query):
    """Supabase returns at most 1000 rows at a time. This asks page by page until
    it has everything (an imported Anki deck can have thousands of cards)."""
    rows, start = [], 0
    while True:
        page = make_query().range(start, start + 999).execute().data
        rows += page
        if len(page) < 1000:
            return rows
        start += 1000


def my_profile(db):
    return db.table("profiles").select("*").execute().data[0]


# Hovering over a word: a short translation + the language it's in
def public_info(person):
    """What OTHER people may see about someone (never their login token)."""
    return {key: person.get(key) for key in ("sid", "user_id", "name", "native", "learning", "fluency", "interests")}


def person_from_token(token):
    """Who is this? Looked up from their login token (we don't just trust the browser)."""
    if not token:
        return None
    rows = db_for(token).table("profiles").select("*").execute().data
    if not rows:
        return None
    return {
        "sid": request.sid,  # unique id for this browser's connection
        **person_details(rows[0]),
        "token": token,      # stays on the server, used to save things as them
    }


def person_details(profile):
    """The parts of a profile (a row of the profiles table) that matching and chats use."""
    return {
        "user_id": profile["id"],   # their account id (for friends + recent contacts)
        "name": profile["username"],
        "native": profile["native"],
        "learning": profile["learning"],
        "translate_to": profile["translate_to"],
        "fluency": profile.get("fluency"),           # e.g. "intermediate" (for matching)
        "interests": profile.get("interests") or [],  # e.g. ["anime", "music"]
    }
