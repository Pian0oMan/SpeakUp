# SPEAK UP: start here.
# All the server code lives in the backend/ folder, one file per topic:
#
#   backend/setup.py        settings (.env), the Flask app, Socket.IO, the database connection
#   backend/account.py      the web page, login settings, profiles
#   backend/translation.py  DeepL + figuring out which language a message is in
#   backend/dictionary.py   word meanings + real pronunciations (Wiktionary, Jisho, ...)
#   backend/anki_import.py  reading Anki deck files (.apkg)
#   backend/decks.py        decks, flashcards, the word popup, library, Anki import, reports
#   backend/progress.py     XP, levels, streaks
#   backend/social.py       who's online, recent contacts, friends (+ their stats)
#   backend/discover.py     the Discover feed: posts about your progress, cheers
#   backend/chat.py         Quick Match, the 1-on-1 chat, icebreakers, captions, calls
#   backend/rooms.py        voice rooms
#   backend/invites.py      inviting friends to your voice room, or to a 1-on-1 call
#
# Importing a file runs it, and that's what connects its pages (@app.route) and
# real-time events (@socketio.on) to the server.
from backend.setup import app, socketio
from backend import account, decks, progress, social, discover, chat, rooms, invites  # noqa: F401  (imported for their routes)

if __name__ == "__main__":
    socketio.run(app, debug=True)
