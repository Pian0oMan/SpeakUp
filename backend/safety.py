# SAFETY: reporting and blocking people, from a 1-on-1 chat, a voice room or Discover.
# A report is saved for the developers to review in Supabase (Table Editor -> user_reports),
# with the last lines of the conversation, so they can see what happened.
# (Blocking on its own also works from the Friends page: see /api/blocks in social.py.)
from flask import request

from backend import chat, rooms
from backend.setup import socketio, db_for, person_from_token
from backend.social import block_user

REASONS = {"harassment", "inappropriate", "hate", "spam", "underage", "other"}


def conversation_with(sid, user_id):
    """The end of my 1-on-1 chat with that person, or of my voice room's side chat.
    It comes from the server's own copy of the messages, not from the browser."""
    partner = chat.partners.get(sid)
    if partner and partner["user_id"] == user_id:
        return "\n".join(chat.chats.get(sid, {}).get("history", [])[-30:])
    room = rooms.rooms.get(rooms.room_of.get(sid))
    if room:
        return "\n".join(f"{msg['name']}: {msg['text']}" for msg in room["history"][-30:])
    return None


@socketio.on("report_user")
def report_user(data):
    """e.g. {"token": ..., "user_id": "...", "name": "Sam", "reason": "harassment",
             "details": "...", "block": true, "where": "chat"}"""
    me = person_from_token(data.get("token"))
    other = data.get("user_id")
    if not me or not other or other == me["user_id"]:
        return
    reason = data.get("reason") if data.get("reason") in REASONS else None
    block = bool(data.get("block"))
    db = db_for(me["token"])
    try:
        if reason:
            db.table("user_reports").insert({
                "reported": other,
                "reported_name": str(data.get("name") or "")[:20],
                "reason": reason,
                "details": str(data.get("details") or "")[:1000] or None,
                "context": conversation_with(request.sid, other),
                "where_from": str(data.get("where") or "")[:20] or None,
            }).execute()
        if block:
            block_user(db, me["user_id"], other, data.get("name"))
    except Exception as error:  # e.g. 12_safety.sql hasn't been run yet
        print("Couldn't save the report or block:", error)
        socketio.emit("report_error", "That didn't work. Please try again in a moment.", to=request.sid)
        return

    # Blocking the person I'm chatting with ends the chat right away
    # (they just see "Your partner left", like when someone clicks Next)
    partner = chat.partners.get(request.sid)
    ended_chat = block and partner is not None and partner["user_id"] == other
    if ended_chat:
        chat.leave_current_chat(request.sid)
    socketio.emit("report_done", {"reported": bool(reason), "blocked": block, "ended_chat": ended_chat},
                  to=request.sid)
