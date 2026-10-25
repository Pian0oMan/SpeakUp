# INVITES: invite a friend to the voice room you're in, or call a friend 1-on-1.
#
#   "room" invite: the friend gets "Yuki invited you to Anime & Manga Talk" -> Join
#   "call" invite: the friend gets "Yuki wants to call you" -> Accept starts a
#                  1-on-1 chat + call (the same as Quick Match, but with your friend)
#
# Only FRIENDS can invite each other, so strangers can't spam anyone.
from flask import request

from backend import chat, rooms
from backend.setup import socketio, db_for
from backend.social import online, person_of

pending_calls = {}  # (caller's user id, friend's user id) -> the caller's connection (sid)


def are_friends(person, other_user_id):
    """Checked in the database, as the inviting person (the security rules apply)."""
    rows = db_for(person["token"]).table("friendships").select("requester, addressee, status").execute().data
    return any(row["status"] == "accepted" and other_user_id in (row["requester"], row["addressee"])
               for row in rows)


def send_to_user(user_id, event, data):
    """Send to every tab this person has open."""
    for sid in online.get(user_id, ()):
        socketio.emit(event, data, to=sid)


@socketio.on("invite")
def invite(data):
    """e.g. {"to": "<friend's user id>", "kind": "room"} or {"to": ..., "kind": "call"}"""
    me = person_of.get(request.sid)
    friend = data.get("to")
    if not me or not friend:
        return
    if friend not in online:
        socketio.emit("invite_error", "Your friend isn't online right now.", to=request.sid)
        return
    if not are_friends(me, friend):
        socketio.emit("invite_error", "You can only invite friends.", to=request.sid)
        return

    if data.get("kind") == "room":
        room = rooms.rooms.get(rooms.room_of.get(request.sid))
        if not room:
            socketio.emit("invite_error", "Join a voice room first.", to=request.sid)
            return
        send_to_user(friend, "invited", {
            "kind": "room", "from": me["name"], "from_user": me["user_id"],
            "room_id": room["id"], "room_name": room["name"], "language": room["language"],
        })
    else:
        pending_calls[(me["user_id"], friend)] = request.sid
        send_to_user(friend, "invited", {"kind": "call", "from": me["name"], "from_user": me["user_id"]})
    socketio.emit("invite_sent", {"kind": data.get("kind")}, to=request.sid)


@socketio.on("answer_call")
def answer_call(data):
    """The friend answered a call invite: {"from_user": "...", "accept": true/false}"""
    me = person_of.get(request.sid)
    if not me:
        return
    caller_sid = pending_calls.pop((data.get("from_user"), me["user_id"]), None)
    caller = person_of.get(caller_sid)
    if not caller:
        socketio.emit("invite_error", "That call isn't there anymore.", to=request.sid)
        return
    if not data.get("accept"):
        socketio.emit("call_declined", me["name"], to=caller_sid)
        return
    # Both leave whatever they were doing, then start the 1-on-1 chat + call
    for sid in (caller_sid, request.sid):
        chat.leave_current_chat(sid)
        rooms.exit_room(sid)
    chat.pair_up({**caller, "sid": caller_sid}, {**me, "sid": request.sid})
