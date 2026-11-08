# SPEAKING TIME: how many minutes I actually spoke, per language, per day.
# The browser measures it (it knows when my microphone hears me talking, see talking.js)
# and reports here about every 30 seconds. Every full minute is also worth XP.
import time
from datetime import timedelta

from flask import request, jsonify

from backend.progress import award_xp, local_today, tz_from_request
from backend.setup import app, socketio, db_for, token_from_request
from backend.social import person_of, tz_of
from backend.translation import DEEPL_CODES

last_report = {}  # sid -> when that connection last reported (nobody can claim more time than passed)
unpaid = {}       # user id -> spoken seconds that haven't earned XP yet (less than a minute)


@socketio.on("spoken")
def spoken(data):
    """e.g. {"Japanese": 25, "English": 3}: seconds I spoke since my last report"""
    me = person_of.get(request.sid)  # who this connection is (from "hello")
    if not me or not isinstance(data, dict):
        return
    now = time.time()
    allowed = min(now - last_report.get(request.sid, now - 60), 120) + 5  # + a little slack
    last_report[request.sid] = now

    db = db_for(me["token"])
    day = local_today(tz_of.get(request.sid, 0)).isoformat()  # MY day, in my time zone
    total = 0
    for language, seconds in data.items():
        try:
            seconds = max(0, min(int(seconds), int(allowed) - total))
        except (TypeError, ValueError):
            continue
        if language not in DEEPL_CODES or seconds == 0:
            continue
        try:
            db.rpc("add_speaking_time", {"p_day": day, "p_language": language, "p_seconds": seconds}).execute()
        except Exception as error:  # e.g. the database didn't answer
            print("Couldn't save speaking time:", error)
            return
        total += seconds

    # XP for every FULL minute; the rest waits for the next report
    minutes, unpaid[me["user_id"]] = divmod(unpaid.get(me["user_id"], 0) + total, 60)
    if minutes:
        award_xp(db, me["user_id"], "speaking", tz_of.get(request.sid, 0), times=minutes)


@app.route("/api/speaking")
def speaking_stats():
    """My speaking time: today, this week (the last 7 days), and per language this week."""
    db = db_for(token_from_request())
    today = local_today(tz_from_request())
    rows = (db.table("speaking_time").select("day, language, seconds")
            .gte("day", (today - timedelta(days=6)).isoformat()).execute().data)
    by_language = {}
    for row in rows:
        by_language[row["language"]] = by_language.get(row["language"], 0) + row["seconds"]
    return jsonify({
        "today": sum(row["seconds"] for row in rows if row["day"] == today.isoformat()),
        "week": sum(by_language.values()),
        "by_language": by_language,  # e.g. {"Japanese": 1520, "English": 300}
    })
