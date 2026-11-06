# SPACED REPETITION: when should a card come back?
#
# Every card has an "interval": how many days until you see it again. Each time you
# remember it, the interval grows (1 day, 3 days, a week, a month...), so you review
# it right before you'd forget it. Forget it, and it starts over.
# (The SM-2 idea that Anki is built on, but with just two buttons, so it's quick.)
#
# After seeing the answer you pick one:
#   dont_know = I didn't know it -> see it again in a minute (later in this session)
#   know      = I knew it        -> the interval grows
# A card I keep forgetting gets a lower "ease", so its interval grows more slowly.
import math
from datetime import datetime, timedelta, timezone

from flask import request, jsonify

from backend.progress import award_xp, tz_from_request
from backend.setup import app, db_for, token_from_request, my_profile

GRADES = ("dont_know", "know")
START_EASE = 2.5     # a remembered card's interval is multiplied by this (lower = harder card)
MIN_EASE = 1.3       # even the hardest card still grows a little
FORGET_PENALTY = 0.2 # forgetting a card lowers its ease by this much
MAX_INTERVAL = 365   # days: every card comes back at least once a year
KNOWN_AFTER = 7      # days: a card you can leave for a week counts as "known" (words learned)
MASTERED_AFTER = 60  # days: the proficiency ring is full at this interval
# The columns the schedule needs (they come from sql/10_review.sql)
SCHEDULE_FIELDS = "due_at, interval_days, ease, reps, lapses, first_studied_at"


def schedule(card, grade, now=None):
    """The card's new schedule after a grade, e.g. a card on a 3-day interval that I
    "know" -> {"interval_days": 7.5, "due_at": "...in 7.5 days...", ...}"""
    now = now or datetime.now(timezone.utc)
    interval = card.get("interval_days") or 0
    ease = card.get("ease") or START_EASE
    reps = card.get("reps") or 0
    lapses = card.get("lapses") or 0

    if grade == "dont_know":
        if reps > 0:
            lapses += 1  # I knew it before, and forgot it
        reps, interval = 0, 0
        ease = max(MIN_EASE, ease - FORGET_PENALTY)
        due = now + timedelta(minutes=1)
    else:  # know: 1 day, then 3 days, then longer and longer
        interval = 1 if reps == 0 else 3 if reps == 1 else interval * ease
        interval = min(MAX_INTERVAL, interval)
        reps += 1
        due = now + timedelta(days=interval)

    return {
        "interval_days": round(interval, 2),
        "ease": round(ease, 2),
        "reps": reps,
        "lapses": lapses,
        "due_at": due.isoformat(),
        "status": "known" if interval >= KNOWN_AFTER else "learning",
        "proficiency": proficiency_of(interval),
    }


def proficiency_of(interval):
    """The ring (0 to 100%) grows with the interval: 1 day = 17%, a week = 51%, 2 months = 100%."""
    return round(100 * min(1, math.log1p(interval) / math.log1p(MASTERED_AFTER)))


def wait_label(seconds):
    """How long until the card comes back, short enough for a button: "10 min", "3 days", "2 mo"."""
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{max(1, minutes)} min"
    days = round(seconds / 86400)
    if days < 1:
        return f"{round(seconds / 3600)} h"
    if days < 30:
        return "1 day" if days == 1 else f"{days} days"
    if days < 365:
        return f"{round(days / 30)} mo"
    return f"{round(days / 365)} yr"


def previews(card, now=None):
    """What each button would do, e.g. {"dont_know": "1 min", "know": "3 days"}"""
    now = now or datetime.now(timezone.utc)
    result = {}
    for grade in GRADES:
        due = datetime.fromisoformat(schedule(card, grade, now)["due_at"])
        result[grade] = wait_label((due - now).total_seconds())
    return result


# The buttons' labels. Only maths, no database: the browser sends the card's schedule.
# e.g. /api/review/previews?interval_days=3&ease=2.5&reps=2
@app.route("/api/review/previews")
def review_previews():
    try:
        card = {"interval_days": float(request.args.get("interval_days", 0)),
                "ease": float(request.args.get("ease", START_EASE)),
                "reps": int(request.args.get("reps", 0))}
    except ValueError:
        return jsonify({"error": "That's not a schedule."}), 400
    return jsonify(previews(card))


@app.route("/api/cards/<int:card_id>/review", methods=["POST"])
def review_card(card_id):
    """I answered a card in study mode: {"grade": "know"}. Returns the card's new schedule."""
    grade = (request.get_json() or {}).get("grade")
    if grade not in GRADES:
        return jsonify({"error": "The grade must be know or dont_know."}), 400
    db = db_for(token_from_request())
    try:
        rows = db.table("flashcards").select("id, word, " + SCHEDULE_FIELDS).eq("id", card_id).execute().data
        upgraded = True
    except Exception:  # 10_review.sql hasn't been run yet: only the ring and the status are saved
        rows = db.table("flashcards").select("id, word").eq("id", card_id).execute().data
        upgraded = False
    if not rows:
        return jsonify({"error": "That card isn't in your decks anymore."}), 404

    card = rows[0]
    changes = schedule(card, grade)
    if not card.get("due_at") and not card.get("first_studied_at"):
        changes["first_studied_at"] = datetime.now(timezone.utc).isoformat()  # a new card, studied today
    saved = changes if upgraded else {key: changes[key] for key in ("status", "proficiency")}
    db.table("flashcards").update(saved).eq("id", card_id).execute()

    # XP for studying: more when I remembered it, but practice still counts
    reason = "know_it" if grade == "know" else "still_learning"
    award_xp(db, my_profile(db)["id"], reason, tz_from_request())
    return jsonify({**card, **changes})
