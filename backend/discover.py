# DISCOVER: a feed where everyone shares their language-learning progress (like LinkedIn),
# and other learners can "cheer" their posts.
from flask import request, jsonify

from backend import progress
from backend.setup import app, socketio, db_for, token_from_request, fetch_all, my_profile

POST_MAX_LENGTH = 500
FEED_SIZE = 50  # the newest 50 posts


def words_learned(db):
    """How many of my cards I've marked "Know it" in study mode."""
    return len(fetch_all(lambda: db.table("flashcards").select("word").eq("status", "known")))


@app.route("/api/posts")
def list_posts():
    db = db_for(token_from_request())
    my_id = my_profile(db)["id"]
    posts = db.table("posts").select("*").order("created_at", desc=True).limit(FEED_SIZE).execute().data
    ids = [post["id"] for post in posts]
    cheers = fetch_all(lambda: db.table("cheers").select("post_id, user_id").in_("post_id", ids)) if ids else []
    for post in posts:
        cheered_by = [cheer["user_id"] for cheer in cheers if cheer["post_id"] == post["id"]]
        post["cheers"] = len(cheered_by)
        post["cheered"] = my_id in cheered_by  # did I cheer it?
        post["mine"] = post["user_id"] == my_id
    return jsonify(posts)


@app.route("/api/posts", methods=["POST"])
def create_post():
    data = request.get_json()  # e.g. {"text": "First full conversation in English!", "share_stats": true}
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"error": "Write something first."}), 400
    if len(text) > POST_MAX_LENGTH:
        return jsonify({"error": f"Posts can be up to {POST_MAX_LENGTH} characters."}), 400
    db = db_for(token_from_request())
    me = my_profile(db)
    post = {
        "author_name": me["username"],
        "country": me.get("country"),
        "native": me["native"],
        "learning": me["learning"],
        "body": text,
    }
    # Their level + interests (once they've answered the welcome questions)
    for key in ("fluency", "interests"):
        if me.get(key):
            post[key] = me[key]
    # The progress card is calculated HERE, so nobody can post fake stats
    if data.get("share_stats"):
        state = progress.progress_state(me, progress.tz_from_request())
        post["stats"] = {"level": state["level"], "streak": state["streak"], "words": words_learned(db)}
    db.table("posts").insert(post).execute()
    socketio.emit("posts_changed")  # everyone looking at Discover sees it right away
    return jsonify({"ok": True})


# "People to meet": people who like the same things as me (see people_to_meet() in the SQL)
@app.route("/api/people")
def people_to_meet():
    try:
        return jsonify(db_for(token_from_request()).rpc("people_to_meet").execute().data)
    except Exception as error:  # e.g. 09_onboarding.sql hasn't been run yet
        print("Couldn't load people to meet:", error)
        return jsonify([])


@app.route("/api/posts/<int:post_id>", methods=["DELETE"])
def delete_post(post_id):
    # The security rules make sure I can only delete MY posts
    db_for(token_from_request()).table("posts").delete().eq("id", post_id).execute()
    socketio.emit("posts_changed")
    return jsonify({"ok": True})


@app.route("/api/posts/<int:post_id>/cheer", methods=["POST"])
def cheer(post_id):
    """Cheer a post, or take the cheer back if I already did."""
    db = db_for(token_from_request())
    my_id = my_profile(db)["id"]
    mine = db.table("cheers").select("post_id").eq("post_id", post_id).eq("user_id", my_id).execute().data
    if mine:
        db.table("cheers").delete().eq("post_id", post_id).eq("user_id", my_id).execute()
    else:
        db.table("cheers").insert({"post_id": post_id}).execute()
    count = len(db.table("cheers").select("user_id").eq("post_id", post_id).execute().data)
    return jsonify({"cheered": not mine, "cheers": count})
