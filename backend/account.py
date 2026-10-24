# ACCOUNT: the web page itself, the login settings, and the user's profile.
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
