# QUICK MATCH: finding a partner, the 1-on-1 chat, icebreakers,
# live captions, and video call messages.
import random
from functools import lru_cache

from flask import request

from backend import rooms  # rooms and chat need each other, so: rooms.exit_room(...)
from backend.progress import award_xp, award_message_xp
from backend.setup import socketio, db_for, person_from_token, public_info
from backend.social import save_recent_contact, go_offline, tz_of
from backend.translation import translate, detect_language, DEEPL_CODES


# ---------- MATCHMAKING ----------
# Kept in memory (plain Python variables), not the database,
# because it only matters while people are online.
waiting = []   # people looking for a partner, e.g. {"sid": ..., "name": "Ana", "native": "Spanish", ...}
partners = {}  # sid -> that person's partner, e.g. partners["abc"] = {"sid": "xyz", "name": "Ana", ...}
chats = {}     # sid -> the chat they're in. Both people point to the SAME chat, e.g.
               # {"history": ["Alex: hey!"], "question": "...", "answered": {"abc"}, "active": True}


def leave_current_chat(sid):
    # Take this person off the waiting list (if they were on it)
    waiting[:] = [person for person in waiting if person["sid"] != sid]
    # If they were chatting, end the chat, break up the pair, and tell the partner
    chat = chats.pop(sid, None)
    if chat:
        chat["active"] = False  # this stops the icebreaker timer
    partner = partners.pop(sid, None)
    if partner:
        partners.pop(partner["sid"], None)
        chats.pop(partner["sid"], None)
        socketio.emit("partner_left", to=partner["sid"])


# ---------- ICEBREAKERS ----------
ICEBREAKER_SECONDS = 360  # how often a new question appears

ICEBREAKERS = [
    "What is your favorite food?",
    "What do you like to do on weekends?",
    "What is a movie or show you love?",
    "If you could visit any country, where would you go?",
    "What music are you listening to lately?",
    "What is the best thing that happened to you this week?",
    "Do you have any pets? Tell me about them.",
    "What is a food from your country that I should try?",
    "What did you want to be when you were a kid?",
    "What is your favorite season, and why?",
    "What is a hobby you would like to start?",
    "What is something people in your country do that might surprise me?",
    "Are you a morning person or a night person?",
    "What is the last thing that made you laugh?",
    "Why are you learning a new language?",
    "What is your dream job?",
    "What would you do with a free day and no plans?",
    "What is a word in your language that is hard to translate?",
]


@lru_cache(maxsize=None)  # remembers results, so each question is only translated once per language
def in_language(text, language):
    """The icebreakers are written in English. This returns one in any language."""
    if language == "English":
        return text
    return translate(text, language) or text


def send_icebreaker(chat):
    question = chat["questions"].pop()
    chat["question"] = question
    chat["answered"] = set()
    for person in chat["people"]:
        # Shown in the language they're learning. Hover over words for help.
        socketio.emit("icebreaker", {
            "question": in_language(question, person["learning"]),
            "language": person["learning"],
            "next_in": ICEBREAKER_SECONDS,
        }, to=person["sid"])


def icebreaker_timer(chat):
    # Runs in the background for as long as the chat lasts
    while chat["active"] and chat["questions"]:
        send_icebreaker(chat)
        socketio.sleep(ICEBREAKER_SECONDS)


@socketio.on("find_partner")
def find_partner(data):
    # Look up WHO this is from their login token (we don't just trust the browser)
    me = person_from_token(data["token"])
    if not me:
        return
    leave_current_chat(request.sid)  # in case they clicked "Next"
    rooms.exit_room(request.sid)           # or they were in a voice room

    # Perfect language exchange: they speak what I'm learning,
    # and they're learning what I speak.
    for other in waiting:
        if other["native"] == me["learning"] and other["learning"] == me["native"]:
            waiting.remove(other)
            pair_up(me, other)
            return

    waiting.append(me)  # nobody fits yet, so wait for someone


def pair_up(me, other):
    """Start a 1-on-1 chat + call between two people.
    Used by Quick Match, and when a friend accepts a call invite."""
    partners[me["sid"]] = other
    partners[other["sid"]] = me
    chat = {
        "people": [me, other],
        "history": [],
        "questions": random.sample(ICEBREAKERS, len(ICEBREAKERS)),  # shuffled, no repeats
        "question": None,
        "answered": set(),
        "active": True,
        "contact_saved": False,  # added to each other's "Recent" list yet?
    }
    chats[me["sid"]] = chats[other["sid"]] = chat  # one shared chat for both
    # Tell each person who they got (only PUBLIC info, never the login token).
    # ONE of them ("initiator") starts the video connection, otherwise both
    # browsers would try at the same time.
    socketio.emit("matched", {**public_info(other), "initiator": True}, to=me["sid"])
    socketio.emit("matched", {**public_info(me), "initiator": False}, to=other["sid"])
    socketio.start_background_task(icebreaker_timer, chat)


@socketio.on("leave")
def handle_leave():
    leave_current_chat(request.sid)


# ---------- CHAT ----------
@socketio.on("chat_message")
def handle_chat_message(text):
    send_chat_message(request.sid, text)


def send_chat_message(sid, text, voice=False, language=None):
    """Send a message from sid to their partner (and back to them).
    voice=True means it was spoken in the call (a finished live caption)."""
    partner = partners.get(sid)
    if not partner:
        return  # not in a chat, nobody to send to
    me = partners[partner["sid"]]  # my partner's partner is me!

    chat = chats[sid]

    # The first message in a chat puts both people in each other's "Recent" list
    if not chat["contact_saved"]:
        chat["contact_saved"] = True
        save_recent_contact(me, partner)

    # The last 6 lines of this conversation help DeepL understand slang and tone
    history = chat["history"]
    # (The first line describes the situation, so even the very first message has context.)
    context = "\n".join(["Casual text chat between two friends."] + history[-6:])
    history.append(f"{me['name']}: {text}")

    # My first message after an icebreaker counts as my answer (spoken ones too!)
    is_answer = chat["question"] is not None and sid not in chat["answered"]
    if is_answer:
        chat["answered"].add(sid)

    # Messages are NOT translated automatically: people hover over words to translate
    # them. We only find out which language the message is IN. The word popup shows
    # it, and it makes single-word translations much more accurate.
    # (For speech we already know: it's the language the speech recognizer listened for.)
    language = language or detect_language(text, me, context)
    for person in (me, partner):
        socketio.emit("chat_message", {
            "from": sid,
            "text": text,
            "language": language,
            "answer": is_answer,
            "voice": voice,
        }, to=person["sid"])

    if is_answer:  # update who-has-answered on the question card for both people
        for person in (me, partner):
            socketio.emit("icebreaker_answered", list(chat["answered"]), to=person["sid"])

    # XP: answering an icebreaker is worth more than a normal message
    if is_answer:
        award_xp(db_for(me["token"]), me["user_id"], "icebreaker", tz_of.get(sid, 0))
    else:
        award_message_xp(me)


# ---------- LIVE CAPTIONS ----------
# While someone talks, their browser turns speech into text and sends it here,
# e.g. {"text": "ラーメンが好き", "final": False, "language": "Japanese"}.
# "final" = they finished the sentence; then it's also added to the chat.
@socketio.on("caption")
def handle_caption(data):
    text = str(data.get("text", "")).strip()[:500]
    language = data.get("language") if data.get("language") in DEEPL_CODES else None
    if not text:
        return

    # In a voice room: everyone else in the room sees it under my name
    room_id = rooms.room_of.get(request.sid)
    if room_id:
        socketio.emit("room_caption", {"sid": request.sid, "text": text, "language": language},
                      to=f"room:{room_id}", skip_sid=request.sid)
        if data.get("final"):
            rooms.send_room_message(request.sid, text, voice=True, language=language)
        return

    # In a 1-on-1 chat: my partner sees it over my video
    partner = partners.get(request.sid)
    if not partner:
        return
    socketio.emit("caption", {"text": text, "language": language}, to=partner["sid"])
    if data.get("final"):
        send_chat_message(request.sid, text, voice=True, language=language)


@socketio.on("typing")
def handle_typing():
    partner = partners.get(request.sid)
    if partner:
        socketio.emit("partner_typing", to=partner["sid"])


# ---------- VIDEO CALLS ----------
# The video and audio go DIRECTLY between the two browsers (WebRTC).
# The server only passes small "call" messages between them so they can
# find each other: invite, accept, decline, offer, answer, candidate, end.
@socketio.on("call")
def relay_call(data):
    partner = partners.get(request.sid)
    if partner:
        socketio.emit("call", data, to=partner["sid"])


# Closing the tab counts as leaving
@socketio.on("disconnect")
def handle_disconnect(reason=None):
    leave_current_chat(request.sid)
    rooms.exit_room(request.sid)
    go_offline(request.sid)
