# PROGRESS: XP, levels, streaks, and the daily goal.
from datetime import datetime, timedelta, timezone

from flask import request, jsonify

from backend.setup import app, socketio, db_for, token_from_request, my_profile
from backend.social import online, tz_of


# ---------- XP, LEVELS, STREAKS ----------
XP_FOR = {
    "message": 2,         # a chat or voice-room message
    "icebreaker": 10,     # answering an icebreaker question
    "save_word": 5,       # a new word saved to a deck
    "know_it": 3,         # study mode: "Know it"
    "still_learning": 1,  # study mode: "Still learning" (practice still counts!)
}
DAILY_GOAL = 50
MESSAGE_XP_EVERY = 20     # seconds: message XP at most this often, so spamming doesn't pay
last_message_xp = {}      # user id -> time of their last message XP


def xp_needed(level):
    """Total XP needed to reach a level: level 2 = 100, level 3 = 300, level 4 = 600..."""
    return 50 * level * (level - 1)


def level_of(xp):
    level = 1
    while xp >= xp_needed(level + 1):
        level += 1
    return level


def local_today(tz_offset):
    """Today's date where the USER is (so the streak resets at their midnight, not the server's)."""
    return (datetime.now(timezone.utc) - timedelta(minutes=tz_offset)).date()


def progress_state(profile, tz_offset):
    """Everything the browser shows: level, XP bar, streak, daily goal."""
    xp = profile.get("xp") or 0
    level = level_of(xp)
    today = local_today(tz_offset)
    last = profile.get("last_active")  # e.g. "2026-10-23", or None
    active_today = last == today.isoformat()
    active_yesterday = last == (today - timedelta(days=1)).isoformat()
    return {
        "xp": xp,
        "level": level,
        "level_start": xp_needed(level),      # XP where this level began
        "level_end": xp_needed(level + 1),    # XP needed for the next level
        # A streak is only "alive" if they practiced today or yesterday
        "streak": (profile.get("streak") or 0) if (active_today or active_yesterday) else 0,
        "best_streak": profile.get("best_streak") or 0,
        "xp_today": (profile.get("xp_today") or 0) if active_today else 0,
        "daily_goal": DAILY_GOAL,
    }


def award_xp(db, user_id, reason, tz_offset):
    """Give XP for doing something, update the streak, and tell the user's open tabs."""
    try:
        profile = db.table("profiles").select("xp, streak, best_streak, last_active, xp_today").execute().data[0]
    except Exception as error:  # e.g. the progress SQL hasn't been run yet: everything else still works
        print("Couldn't award XP:", error)
        return
    amount = XP_FOR[reason]
    today = local_today(tz_offset)
    last = profile.get("last_active")
    if last == today.isoformat():                                  # already practiced today
        streak, xp_today = profile["streak"], profile["xp_today"] + amount
    elif last == (today - timedelta(days=1)).isoformat():          # practiced yesterday: streak grows
        streak, xp_today = profile["streak"] + 1, amount
    else:                                                          # first time, or missed a day
        streak, xp_today = 1, amount
    old_level = level_of(profile["xp"])
    new = {
        "xp": profile["xp"] + amount,
        "streak": streak,
        "best_streak": max(profile["best_streak"], streak),
        "last_active": today.isoformat(),
        "xp_today": xp_today,
    }
    db.table("profiles").update(new).eq("id", user_id).execute()
    state = progress_state(new, tz_offset)
    state.update({"gained": amount, "reason": reason, "level_up": state["level"] > old_level})
    for sid in online.get(user_id, ()):  # every tab they have open
        socketio.emit("xp", state, to=sid)


def award_message_xp(person):
    """Message XP for someone in a chat or voice room (not more often than every 20 seconds)."""
    now = datetime.now(timezone.utc).timestamp()
    if now - last_message_xp.get(person["user_id"], 0) < MESSAGE_XP_EVERY:
        return
    last_message_xp[person["user_id"]] = now
    award_xp(db_for(person["token"]), person["user_id"], "message", tz_of.get(person["sid"], 0))


def tz_from_request():
    """REST requests send the browser's time zone in a header."""
    try:
        return int(request.headers.get("X-TZ-Offset", 0))
    except ValueError:
        return 0


@app.route("/api/progress")
def get_progress():
    db = db_for(token_from_request())
    return jsonify(progress_state(my_profile(db), tz_from_request()))
