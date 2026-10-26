# SETUP: what every other file needs: the settings from .env, the Flask app,
# Socket.IO, the Supabase database connection, and "who is this?" helpers.
import os

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

# This file is in speakup/backend/, the website files are in speakup/static/
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=os.path.join(ROOT, "static"))
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # uploads (Anki decks) up to 50 MB
socketio = SocketIO(app)  # adds real-time "always open" connections


# DATABASE: a Supabase connection that acts AS the logged-in user.
# The token proves who they are, and the security rules in sql/01_setup.sql
# make sure they can only touch their own rows.
def db_for(token):
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


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
    profile = rows[0]
    return {
        "sid": request.sid,         # unique id for this browser's connection
        "user_id": profile["id"],   # their account id (for friends + recent contacts)
        "name": profile["username"],
        "native": profile["native"],
        "learning": profile["learning"],
        "translate_to": profile["translate_to"],
        "fluency": profile.get("fluency"),           # e.g. "intermediate" (for matching)
        "interests": profile.get("interests") or [],  # e.g. ["anime", "music"]
        "token": token,             # stays on the server, used to save things as them
    }
