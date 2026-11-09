# ACCOUNT: the web page itself, the login settings, and the user's profile.
import re

from flask import request, jsonify, send_from_directory

from backend.setup import (app, db_for, token_from_request, SUPABASE_URL, SUPABASE_ANON_KEY,
                           TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL)
from backend import social
from backend.translation import ACTIVE_LANGUAGES, DEEPL_CODES


# Visiting http://localhost:5000/ sends the HTML page
@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


# The service worker: what makes Speak Up installable as an app (see static/sw.js).
# It has to come from "/" (not "/static/"), so it's allowed to handle the whole site.
@app.route("/sw.js")
def service_worker():
    response = send_from_directory(app.static_folder, "sw.js")
    response.headers["Cache-Control"] = "no-cache"  # so a new version is picked up right away
    return response


# The browser needs these values to log in with Supabase and to connect calls.
# (The anon key is safe to share: the security rules protect the data.
# The TURN password is shared too: that's how TURN works with a fixed password,
# so use a TURN service with a monthly limit.)
@app.route("/api/config")
def config():
    ice_servers = [{"urls": "stun:stun.l.google.com:19302"}]  # free: tells each browser its address
    if TURN_URLS:
        ice_servers.append({"urls": TURN_URLS, "username": TURN_USERNAME, "credential": TURN_CREDENTIAL})
    return jsonify({"url": SUPABASE_URL, "anonKey": SUPABASE_ANON_KEY, "iceServers": ice_servers})


# ---------- PROFILE ----------
# The answers the welcome questions can save (keep these in sync with core.js)
FLUENCY = ["beginner", "elementary", "intermediate", "advanced"]
STUDYING_FOR = ["just_started", "under_6_months", "6_to_12_months", "1_to_3_years", "over_3_years"]
INTERESTS = [
    "anime", "music", "gaming", "movies", "books", "travel", "food", "sports", "fitness", "art",
    "photography", "tech", "science", "history", "fashion", "nature", "kpop", "business", "languages", "memes",
]
MAX_INTERESTS = 10
MAX_NAME = 20  # same as maxlength on the name boxes in index.html

@app.route("/api/profile", methods=["GET"])
def get_profile():
    rows = db_for(token_from_request()).table("profiles").select("*").execute().data
    return jsonify(rows[0] if rows else None)  # None = hasn't set up a profile yet


@app.route("/api/profile", methods=["PUT"])
def save_profile():
    data = request.get_json()
    # The languages to speak + learn must be open (ACTIVE_LANGUAGES in translation.py)
    if data.get("native") not in ACTIVE_LANGUAGES or data.get("learning") not in ACTIVE_LANGUAGES:
        return jsonify({"error": "Pick English or Japanese."}), 400
    if data["native"] == data["learning"]:
        return jsonify({"error": "Pick a language you're learning that you don't already speak."}), 400
    if data.get("translate_to") not in DEEPL_CODES:
        return jsonify({"error": "That translation language isn't available."}), 400
    # A name is needed: avatars show its first letter, so a blank one breaks them
    username = str(data.get("username") or "").strip()[:MAX_NAME]
    if not username:
        return jsonify({"error": "Pick a name."}), 400
    changes = {
        "username": username,
        "native": data["native"],
        "learning": data["learning"],
        "translate_to": data["translate_to"],
    }
    # Where I'm from: a 2-letter country code like "JP" (only saved once one is picked,
    # so saving still works before 08_friends_discover.sql adds the column)
    country = str(data.get("country") or "").upper()
    if re.fullmatch(r"[A-Z]{2}", country):
        changes["country"] = country
    # The welcome questions: only answers from the lists above are saved
    extras = {}
    if data.get("fluency") in FLUENCY:
        extras["fluency"] = data["fluency"]
    if data.get("studying_for") in STUDYING_FOR:
        extras["studying_for"] = data["studying_for"]
    if isinstance(data.get("interests"), list):
        extras["interests"] = [topic for topic in INTERESTS if topic in data["interests"]][:MAX_INTERESTS]

    saved = db_for(token_from_request()).table("profiles").upsert({**changes, **extras}).execute().data
    if saved:
        social.profile_changed(saved[0])  # matching uses my new languages right away
    return jsonify({"ok": True})
