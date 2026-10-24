# VOICE ROOMS: group voice chats (3 to 10 people) with a side chat.
import random

from flask import request
from flask_socketio import join_room, leave_room

from backend import chat  # rooms and chat need each other, so: chat.leave_current_chat(...)
from backend.progress import award_message_xp
from backend.setup import socketio, person_from_token, public_info
from backend.translation import detect_language, DEEPL_CODES


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
            "max_size": room["max_size"], "host": room["host"], "count": len(room["members"]),
            # account ids of who's inside (for the "friends only" filter), nothing private
            "member_ids": [member["user_id"] for member in room["members"].values()]}


def broadcast_rooms():
    socketio.emit("rooms", [room_summary(room) for room in rooms.values()])  # to everyone online


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


@socketio.on("join_random_room")
def join_random_room(data):
    """Drop me into a random open room in my language, preferring rooms where people
    are already talking (an empty room isn't much of a conversation)."""
    person = person_from_token(data.get("token"))
    if not person:
        return
    language = data.get("language") or person["learning"]
    open_rooms = [room for room in rooms.values()
                  if room["language"] == language
                  and len(room["members"]) < room["max_size"]
                  and person["sid"] not in room["members"]]
    with_people = [room for room in open_rooms if room["members"]]
    choices = with_people or open_rooms
    if not choices:
        socketio.emit("room_error", f"No open {language} rooms right now. Try creating one!", to=request.sid)
        return
    enter_room(random.choice(choices), person)


def enter_room(room, person):
    sid = person["sid"]
    if room_of.get(sid) == room["id"]:
        return  # already in this room
    chat.leave_current_chat(sid)  # leave any 1-on-1 chat or search...
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
    award_message_xp(person)


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
