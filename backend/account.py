# ACCOUNT: the web page itself, the login settings, and the user's profile.
import re

from flask import request, jsonify, send_from_directory

from backend.setup import app, db_for, token_from_request, SUPABASE_URL, SUPABASE_ANON_KEY


# Visiting http://localhost:5000/ sends the HTML page
@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


# The browser needs these two values to log in with Supabase.
# (The anon key is safe to share: the security rules protect the data.)
@app.route("/api/config")
def config():
    return jsonify({"url": SUPABASE_URL, "anonKey": SUPABASE_ANON_KEY})


# ---------- PROFILE ----------
# The answers the welcome questions can save (keep these in sync with core.js)
FLUENCY = ["beginner", "elementary", "intermediate", "advanced"]
STUDYING_FOR = ["just_started", "under_6_months", "6_to_12_months", "1_to_3_years", "over_3_years"]
INTERESTS = [
    "anime", "music", "gaming", "movies", "books", "travel", "food", "sports", "fitness", "art",
    "photography", "tech", "science", "history", "fashion", "nature", "kpop", "business", "languages", "memes",
]
MAX_INTERESTS = 10

@app.route("/api/profile", methods=["GET"])
def get_profile():
    rows = db_for(token_from_request()).table("profiles").select("*").execute().data
    return jsonify(rows[0] if rows else None)  # None = hasn't set up a profile yet


@app.route("/api/profile", methods=["PUT"])
def save_profile():
    data = request.get_json()
    changes = {
        "username": data["username"],
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

    db = db_for(token_from_request())
    try:
        db.table("profiles").upsert({**changes, **extras}).execute()
    except Exception as error:
        # 09_onboarding.sql hasn't been run yet: save the basics, so signing up still works
        print("Saved the profile without level/interests:", error)
        db.table("profiles").upsert(changes).execute()
    return jsonify({"ok": True})
