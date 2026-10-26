# SOCIAL: who's online, recent contacts, and friends.
from datetime import datetime, timezone

from flask import request, jsonify

from backend import progress
from backend.setup import app, socketio, db_for, token_from_request, my_profile, person_from_token

tz_of = {}                # sid -> the browser's time zone offset (minutes, like JavaScript's getTimezoneOffset)


# ---------- ONLINE STATUS ----------
# Right after logging in, the browser says "hello" with its login token,
# so the server knows which account is behind each connection.
online = {}   # user id -> set of their open connections (one per browser tab)
user_of = {}  # sid -> user id
person_of = {}  # sid -> who that is: name, languages, login token (stays on the server)


@socketio.on("hello")
def hello(data):
    person = person_from_token(data.get("token"))
    if not person:
        return
    go_offline(request.sid)  # in case this connection said hello before (e.g. new login)
    user_of[request.sid] = person["user_id"]
    person_of[request.sid] = person  # who this connection is (for invites)
    online.setdefault(person["user_id"], set()).add(request.sid)
    tz_of[request.sid] = int(data.get("tz", 0))  # for streaks: when is midnight for them?


def go_offline(sid):
    person_of.pop(sid, None)
    user_id = user_of.pop(sid, None)
    if user_id in online:
        online[user_id].discard(sid)
        if not online[user_id]:
            del online[user_id]  # no tabs left open: they're offline


@socketio.on("who_is_online")
def who_is_online(user_ids):
    """The browser asks about a list of people (friends, recent contacts)."""
    socketio.emit("online", [user_id for user_id in user_ids if user_id in online], to=request.sid)


def notify_user(user_id):
    """Tell someone (in every tab they have open) that their friends/recent list changed."""
    for sid in online.get(user_id, ()):
        socketio.emit("social_changed", to=sid)


# ---------- RECENT CONTACTS + FRIENDS ----------
def save_recent_contact(me, other):
    """Two people started chatting: put them in each other's "Recent" list."""
    a, b = sorted([me, other], key=lambda person: person["user_id"])  # the database wants user_a < user_b
    if a["user_id"] == b["user_id"]:
        return  # the same account in two tabs
    try:
        db_for(me["token"]).table("recent_contacts").upsert({
            "user_a": a["user_id"], "user_b": b["user_id"],
            "name_a": a["name"], "name_b": b["name"],
            "last_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_a,user_b").execute()
    except Exception as error:  # e.g. the friends SQL hasn't been run yet: chatting still works
        print("Couldn't save recent contact:", error)
        return
    notify_user(me["user_id"])
    notify_user(other["user_id"])


@app.route("/api/social")
def social():
    """Everything for the Friends page and the Recent panel, in one request."""
    db = db_for(token_from_request())
    my_id = my_profile(db)["id"]
    friends, incoming, outgoing, relation = [], [], [], {}
    for row in db.table("friendships").select("*").execute().data:
        sent_by_me = row["requester"] == my_id
        person = {
            "id": row["id"],  # the friendship's id (to accept / remove it)
            "user_id": row["addressee"] if sent_by_me else row["requester"],
            "name": row["addressee_name"] if sent_by_me else row["requester_name"],
        }
        if row["status"] == "accepted":
            friends.append(person)
            relation[person["user_id"]] = "friend"
        elif sent_by_me:
            outgoing.append(person)
            relation[person["user_id"]] = "requested"
        else:
            incoming.append(person)
            relation[person["user_id"]] = "incoming"

    recent = []
    rows = db.table("recent_contacts").select("*").order("last_at", desc=True).limit(20).execute().data
    for row in rows:
        mine_is_a = row["user_a"] == my_id
        user_id = row["user_b"] if mine_is_a else row["user_a"]
        recent.append({
            "user_id": user_id,
            "name": row["name_b"] if mine_is_a else row["name_a"],
            "last_at": row["last_at"],
            "relation": relation.get(user_id),  # friend / requested / incoming / None
        })
    add_friend_stats(db, friends)
    return jsonify({"friends": friends, "incoming": incoming, "outgoing": outgoing, "recent": recent})


def add_friend_stats(db, friends):
    """Add each friend's country, languages, level, streak, words learned and "last online"
    (from the friend_cards() database function, which only shows MY friends)."""
    try:
        cards = {row["user_id"]: row for row in db.rpc("friend_cards").execute().data}
    except Exception as error:  # e.g. 08_friends_discover.sql hasn't been run yet
        print("Couldn't load friend stats:", error)
        return
    for person in friends:
        card = cards.get(person["user_id"])
        if not card:
            continue
        state = progress.progress_state(card, progress.tz_from_request())
        person.update({
            "country": card["country"],
            "native": card["native"],
            "learning": card["learning"],
            "fluency": card.get("fluency"),
            "interests": card.get("interests") or [],
            "level": state["level"],
            "streak": state["streak"],  # 0 if they haven't practiced since yesterday
            "words": card["words_learned"],
            "last_seen": card["last_seen"],
        })


# The browser calls this every couple of minutes while the app is open,
# so friends can see "Last online 5 min ago"
@app.route("/api/seen", methods=["POST"])
def seen():
    db = db_for(token_from_request())
    try:
        db.table("profiles").update({"last_seen": datetime.now(timezone.utc).isoformat()})             .eq("id", my_profile(db)["id"]).execute()
    except Exception as error:  # e.g. the SQL for last_seen hasn't been run yet
        print("Couldn't save last seen:", error)
    return jsonify({"ok": True})


@app.route("/api/friends", methods=["POST"])
def add_friend():
    data = request.get_json()  # {"user_id": "...", "name": "Yuki"}
    db = db_for(token_from_request())
    me = my_profile(db)
    other = data.get("user_id")
    if not other or other == me["id"]:
        return jsonify({"error": "You can't add yourself."}), 400
    for row in db.table("friendships").select("*").execute().data:
        if {row["requester"], row["addressee"]} == {me["id"], other}:
            # They already asked me? Then my request just means "yes!"
            if row["addressee"] == me["id"] and row["status"] == "pending":
                db.table("friendships").update({"status": "accepted"}).eq("id", row["id"]).execute()
                notify_user(other)
            return jsonify({"ok": True})
    db.table("friendships").insert({
        "addressee": other,
        "requester_name": me["username"],
        "addressee_name": str(data.get("name", ""))[:20] or "Someone",
    }).execute()
    notify_user(other)  # their Friends page updates right away if they're online
    return jsonify({"ok": True})


@app.route("/api/friends/<int:friendship_id>/accept", methods=["POST"])
def accept_friend(friendship_id):
    db = db_for(token_from_request())
    rows = db.table("friendships").select("requester").eq("id", friendship_id).execute().data
    # The security rules make sure only the person who RECEIVED the request can do this
    db.table("friendships").update({"status": "accepted"}).eq("id", friendship_id).execute()
    if rows:
        notify_user(rows[0]["requester"])
    return jsonify({"ok": True})


@app.route("/api/friends/<int:friendship_id>", methods=["DELETE"])
def remove_friend(friendship_id):
    """Remove a friend, decline a request, or cancel one I sent."""
    db = db_for(token_from_request())
    rows = db.table("friendships").select("requester, addressee").eq("id", friendship_id).execute().data
    db.table("friendships").delete().eq("id", friendship_id).execute()
    for row in rows:
        notify_user(row["requester"])
        notify_user(row["addressee"])
    return jsonify({"ok": True})
