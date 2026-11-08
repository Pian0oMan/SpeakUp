# QUICK MATCH: finding a partner, the 1-on-1 chat, icebreakers,
# live captions, and video call messages.
import random
import threading
import time

from flask import request

from backend import rooms, social, speaking  # rooms and chat need each other, so: rooms.exit_room(...)
from backend.progress import award_xp, award_message_xp, last_message_xp
from backend.setup import socketio, db_for, db_as, person_from_token, public_info
from backend.social import save_recent_contact, go_offline, tz_of, my_blocks, current_person
from backend.translation import translate, detect_language, DEEPL_CODES


# ---------- MATCHMAKING ----------
# Kept in memory (plain Python variables), not the database,
# because it only matters while people are online.
waiting = []   # people looking for a partner, longest-waiting first, e.g. {"sid": ..., "name": "Ana", ...}
partners = {}  # sid -> that person's partner, e.g. partners["abc"] = {"sid": "xyz", "name": "Ana", ...}
chats = {}     # sid -> the chat they're in. Both people point to the SAME chat, e.g.
               # {"history": ["Alex: hey!"], "question": "...", "answered": {"abc"}, "active": True}

# Several people can click "Start" at the same moment (each one is handled at the same
# time), and the matcher below runs on its own too. The lock makes them take turns with
# the waiting list, so nobody gets matched twice.
match_lock = threading.RLock()

RELAX_AFTER = 20  # seconds: after waiting this long, "good enough" partners count too (see match_kind)
matcher_started = False


def leave_current_chat(sid):
    # Take this person off the waiting list (if they were on it)
    with match_lock:
        before = len(waiting)
        waiting[:] = [person for person in waiting if person["sid"] != sid]
        if len(waiting) != before:
            broadcast_queue()
    # If they were chatting, end the chat, break up the pair, and tell the partner
    chat = chats.pop(sid, None)
    if chat:
        chat["active"] = False  # this stops the icebreaker timer
    partner = partners.pop(sid, None)
    if partner:
        partners.pop(partner["sid"], None)
        chats.pop(partner["sid"], None)
        socketio.emit("partner_left", to=partner["sid"])


def match_kind(a, b):
    """How well two people fit:
      "perfect": a real exchange (a speaks what b learns, AND b speaks what a learns)
      "half":    one of them speaks what the other is learning
      "peers":   they're learning the same language, and can practice it together
      None:      no match (or one of them blocked the other, or it's the same account)"""
    if a["user_id"] == b["user_id"] or a["user_id"] in b.get("blocked", ()) or b["user_id"] in a.get("blocked", ()):
        return None
    a_helps_b = a["native"] == b["learning"]
    b_helps_a = b["native"] == a["learning"]
    if a_helps_b and b_helps_a:
        return "perfect"
    if a_helps_b or b_helps_a:
        return "half"
    if a["learning"] == b["learning"]:
        return "peers"
    return None


KIND_RANK = {"perfect": 3, "half": 2, "peers": 1}


@socketio.on("find_partner")
def find_partner(data):
    # Look up WHO this is from their login token (we don't just trust the browser)
    me = current_person(data.get("token"))
    if not me:
        return
    leave_current_chat(request.sid)  # in case they clicked "Next"
    rooms.exit_room(request.sid)     # or they were in a voice room
    me["blocked"] = set(my_blocks(db_for(me["token"])))  # never matched with people I blocked
    me["since"] = time.time()                            # when I started waiting
    start_matcher()

    with match_lock:
        # Perfect language exchange: they speak what I'm learning,
        # and they're learning what I speak.
        fits = [other for other in waiting if match_kind(me, other) == "perfect"]
        if fits:
            # Of everyone who fits, pick the best match (same interests, similar level).
            # Nobody waits longer because of this: if anyone fits, I get matched now.
            # (max() keeps the FIRST of equally good matches = whoever has waited longest)
            other = max(fits, key=lambda person: match_score(me, person))
            waiting.remove(other)
            broadcast_queue()
            pair_up(me, other)
            return

        waiting.append(me)  # nobody fits yet, so wait for someone (the matcher keeps trying)
        broadcast_queue()


FLUENCY_ORDER = ["beginner", "elementary", "intermediate", "advanced"]


def match_score(me, other):
    """Higher = a better match: 2 points per shared interest, minus 1 per step of level difference."""
    shared = len(set(me.get("interests") or []) & set(other.get("interests") or []))
    score = 2 * shared
    if me.get("fluency") in FLUENCY_ORDER and other.get("fluency") in FLUENCY_ORDER:
        score -= abs(FLUENCY_ORDER.index(me["fluency"]) - FLUENCY_ORDER.index(other["fluency"]))
    return score


# ---------- WAITING TOO LONG: "good enough" partners ----------
# A perfect exchange partner isn't always online. After RELAX_AFTER seconds, people who
# are still waiting can also be matched with a native speaker who's learning something
# else ("half"), or someone learning the same language ("peers"), if THEY have waited too.
def start_matcher():
    global matcher_started
    with match_lock:
        if matcher_started:
            return
        matcher_started = True
    socketio.start_background_task(relaxed_matcher)


def relaxed_matcher():
    while True:  # runs in the background for as long as the server runs
        socketio.sleep(5)
        with match_lock:
            match_patient_people()


def match_patient_people():
    now = time.time()
    patient = [person for person in waiting if now - person["since"] >= RELAX_AFTER]  # longest-waiting first
    for person in patient:
        if not person.get("told_relaxed"):
            person["told_relaxed"] = True
            socketio.emit("search_relaxed", to=person["sid"])  # "we'll also try other partners now"
    matched = False
    while patient:
        person = patient.pop(0)
        options = [(KIND_RANK[kind], match_score(person, other), kind, other)
                   for other in patient if (kind := match_kind(person, other))]
        if not options:
            continue
        _, _, kind, other = max(options, key=lambda option: option[:2])  # the best kind, then the best score
        patient.remove(other)
        waiting.remove(person)
        waiting.remove(other)
        pair_up(person, other, kind=kind)
        matched = True
    if matched:
        broadcast_queue()


# ---------- WHO'S WAITING ----------
# Everyone sees how many people are waiting, per language pair, e.g. {"Japanese>English": 2}
# (2 people who speak Japanese and are learning English). No names, just numbers.
def queue_counts():
    counts = {}
    for person in waiting:
        key = f"{person['native']}>{person['learning']}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def broadcast_queue():
    socketio.emit("queue", queue_counts())  # to everyone online


@socketio.on("list_queue")
def list_queue():
    socketio.emit("queue", queue_counts(), to=request.sid)


def pair_up(me, other, kind="perfect"):
    """Start a 1-on-1 chat + call between two people.
    Used by Quick Match, and when a friend accepts a call invite (kind="friend")."""
    partners[me["sid"]] = other
    partners[other["sid"]] = me
    chat = {
        "people": [me, other],
        "history": [],
        "questions": icebreakers_for(me, other),
        "question": None,
        "answered": set(),
        "active": True,
        "contact_saved": False,  # added to each other's "Recent" list yet?
    }
    chats[me["sid"]] = chats[other["sid"]] = chat  # one shared chat for both
    # Tell each person who they got (only PUBLIC info, never the login token).
    # ONE of them ("initiator") starts the video connection, otherwise both
    # browsers would try at the same time. "match" says how good the match is.
    socketio.emit("matched", {**public_info(other), "initiator": True, "match": kind}, to=me["sid"])
    socketio.emit("matched", {**public_info(me), "initiator": False, "match": kind}, to=other["sid"])
    socketio.start_background_task(icebreaker_timer, chat)


@socketio.on("leave")
def handle_leave():
    leave_current_chat(request.sid)


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

# Questions about the things two people BOTH like (the interests from the welcome
# questions; the names match INTERESTS in account.py). These come first.
INTEREST_ICEBREAKERS = {
    "anime": ["What anime would you show someone who has never watched one?",
              "Which anime character are you most like?"],
    "music": ["What song have you been listening to on repeat?",
              "Which concert would you love to go to?"],
    "gaming": ["What game have you spent the most hours playing?",
               "Do you like playing games alone or with friends?"],
    "movies": ["What movie could you watch again and again?",
               "What show should I watch next?"],
    "books": ["What book changed the way you think?",
              "What are you reading right now?"],
    "travel": ["What is the best trip you have ever taken?",
               "Where do you want to travel next?"],
    "food": ["What dish do you cook best?",
             "What is the strangest food you have ever tried?"],
    "sports": ["What sport do you love to watch or play?",
               "Which team do you support, and why?"],
    "fitness": ["What does your favorite workout look like?",
                "How do you stay motivated to exercise?"],
    "art": ["What kind of art do you like to make or look at?",
            "Who is your favorite artist?"],
    "photography": ["What do you love to take photos of?",
                    "What is the best photo you have ever taken?"],
    "tech": ["Which app could you not live without?",
             "What new technology are you excited about?"],
    "science": ["What science fact amazes you?",
                "If you could research anything, what would it be?"],
    "history": ["Which time in history would you like to visit?",
                "Which person from history would you like to meet?"],
    "fashion": ["How would you describe your style?",
                "What is your favorite piece of clothing?"],
    "nature": ["What is your favorite animal, and why?",
               "What is the most beautiful place in nature you have been to?"],
    "kpop": ["Who is your favorite K-pop or J-pop artist?",
             "Which song would you use to get someone into K-pop or J-pop?"],
    "business": ["What business would you start if you could?",
                 "What do you enjoy most about your work or studies?"],
    "languages": ["Which other languages would you like to learn?",
                  "What is your favorite word in any language?"],
    "memes": ["What meme always makes you laugh?",
              "What meme is popular in your country right now?"],
}


def icebreakers_for(me, other):
    """The questions for one chat, shuffled, no repeats. The LAST one is asked first
    (send_icebreaker pops from the end), so questions about shared interests go last."""
    shared = set(me.get("interests") or []) & set(other.get("interests") or [])
    about_us = [question for topic in sorted(shared) for question in INTEREST_ICEBREAKERS.get(topic, [])]
    return random.sample(ICEBREAKERS, len(ICEBREAKERS)) + random.sample(about_us, min(6, len(about_us)))


translated_icebreakers = {}  # (question, language) -> translation, so each is only translated once


def in_language(text, language):
    """The icebreakers are written in English. This returns one in any language."""
    if language == "English":
        return text
    if (text, language) not in translated_icebreakers:
        translation = translate(text, language)
        if not translation:
            return text  # DeepL didn't answer (e.g. a timeout): English for now, try again next time
        translated_icebreakers[(text, language)] = translation
    return translated_icebreakers[(text, language)]


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


# ---------- CHAT ----------
@socketio.on("chat_message")
def handle_chat_message(text):
    send_chat_message(request.sid, str(text)[:1000])


def send_chat_message(sid, text, voice=False, language=None):
    """Send a message from sid to their partner (and back to them).
    voice=True means it was spoken in the call (a finished live caption)."""
    partner = partners.get(sid)
    if not partner or not text.strip():
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
        award_xp(db_as(me), me["user_id"], "icebreaker", tz_of.get(sid, 0))
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


# ---------- LOST CONNECTION: getting back into the chat ----------
# Phones lose the connection for a moment all the time (switching from Wi-Fi to mobile
# data, going through a tunnel...). Then the browser reconnects with a NEW connection id.
# So a 1-on-1 chat isn't ended right away: the partner sees "reconnecting...", and if
# the browser comes back within RECONNECT_SECONDS, the chat just continues.
RECONNECT_SECONDS = 20
dropped = {}  # old sid -> when that connection dropped (while it was in a 1-on-1 chat)


@socketio.on("connect")
def handle_connect(auth=None):
    """A browser connected. If it lost its connection during a chat, it sends
    {"token": ..., "resume": "<its old connection id>"} to get back in."""
    if isinstance(auth, dict) and auth.get("resume"):
        resume_chat(str(auth["resume"]), auth.get("token"))


def resume_chat(old_sid, token):
    me_now = person_from_token(token)  # who's asking (a partner also knows my old id, so check!)
    with match_lock:
        partner = partners.get(old_sid)
        if old_sid not in dropped or not me_now or not partner:
            socketio.emit("partner_left", to=request.sid)  # too late: the chat is over
            return
        me = partners[partner["sid"]]  # my old details (the same dict as in chat["people"])
        if me["user_id"] != me_now["user_id"]:
            socketio.emit("partner_left", to=request.sid)
            return
        del dropped[old_sid]
        new_sid = request.sid
        me["sid"], me["token"] = new_sid, me_now["token"]  # (this also updates chat["people"])
        partners[new_sid] = partners.pop(old_sid)
        chat = chats[new_sid] = chats.pop(old_sid)
        if old_sid in chat["answered"]:
            chat["answered"].discard(old_sid)
            chat["answered"].add(new_sid)
    # My browser swaps my old id for the new one (so my messages still show as mine)
    socketio.emit("chat_resumed", {"old_sid": old_sid}, to=new_sid)
    socketio.emit("partner_back", {"old_sid": old_sid, "sid": new_sid}, to=partner["sid"])


def end_chat_if_not_back(sid):
    socketio.sleep(RECONNECT_SECONDS)
    with match_lock:
        if dropped.pop(sid, None) is None:
            return  # they came back (or the chat ended some other way)
        leave_current_chat(sid)


@socketio.on("disconnect")
def handle_disconnect(reason=None):
    sid = request.sid
    user_id = social.user_of.get(sid)
    # A lost connection during a chat: wait a little for them to come back.
    # (Closing the tab or logging out says goodbye properly: "client disconnect".)
    with match_lock:
        in_chat = sid in partners
        if in_chat and reason != socketio.reason.CLIENT_DISCONNECT:
            dropped[sid] = time.time()
            socketio.emit("partner_reconnecting", to=partners[sid]["sid"])
            socketio.start_background_task(end_chat_if_not_back, sid)
        else:
            leave_current_chat(sid)
    rooms.exit_room(sid)
    go_offline(sid)
    speaking.last_report.pop(sid, None)
    if user_id and user_id not in social.online:  # no tabs left open: forget their timers too
        last_message_xp.pop(user_id, None)
        speaking.unpaid.pop(user_id, None)
