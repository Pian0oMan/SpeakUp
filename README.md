# Speak Up

Learn a language by talking to people who speak it. Quick Match pairs you with someone
who speaks the language you're learning (and is learning yours) for a video, voice or
text chat. Hover any word to translate it, save it to a deck, and review it with spaced
repetition until you know it.

**Languages:** Speak Up starts with **English ⇄ Japanese**, so everyone who signs up can
find a partner. The code supports more (Spanish, French, German, Chinese, Russian): to open
one up, add it to `ACTIVE_LANGUAGES` in `backend/translation.py` and `LANGUAGES` in
`static/js/core.js`.

**Built with:** Python + Flask + Flask-SocketIO (the server), Supabase (accounts and the
database), DeepL (translations), WebRTC (calls, browser to browser), and plain HTML, CSS
and JavaScript (the website, in `static/`).

## Running it on your computer

1. **Python packages** (once). In a terminal, in this folder:
   ```
   python -m venv .venv
   .venv\Scripts\activate        (on Mac/Linux: source .venv/bin/activate)
   pip install -r requirements.txt
   ```
2. **Settings.** Copy `.env.example` to `.env` and fill in your keys.
3. **The database.** Run the files in `sql/` in Supabase, in order (see [sql/README.md](sql/README.md)).
4. **Start it:** `python app.py`, then open http://localhost:5000

To test matching on one computer, open a second browser (or a private window) and log in
with a second account.

## Where things are

- `app.py` starts everything. The server code is in `backend/`, one file per topic
  (the list is at the top of `app.py`).
- `static/index.html` is the whole page. `static/js/` and `static/css/` have one file
  per part of the app.
- `sql/` builds the database.

## Calls on strict networks (TURN)

Calls go directly from browser to browser. On some networks (schools, offices, some phone
networks) that's blocked, and the call never connects. A TURN server fixes that by passing
the call along. TURN services such as [Metered](https://www.metered.ca/stun-turn) have a
free plan with a fixed username and password. Put what they give you in `.env`:

```
TURN_URLS=turn:your.turn.server:80,turn:your.turn.server:443?transport=tcp
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

The TURN password is sent to every visitor's browser (that's how fixed TURN passwords
work), so pick a plan with a monthly limit.

## Putting it online

Any host that runs Python works (Render, Railway, Fly.io, a VPS...). The `Procfile`
has the start command:

```
gunicorn --workers 1 --threads 100 --bind 0.0.0.0:$PORT app:app
```

- **One worker only.** Who's waiting, the voice rooms and who's online are kept in the
  server's memory, so everything has to run in one process. (Threads are fine.)
- **HTTPS is required** for the camera and microphone. Most hosts give you HTTPS
  automatically.
- Add the same settings as in `.env` in your host's "environment variables" page.
- Restarting the server ends all chats and empties the voice rooms (people just click
  Start again). Decks, friends and progress are in Supabase, so they're safe.

Once it's online, people can **install it as an app**: in Chrome or Edge, the install
button in the address bar; on a phone, "Add to Home Screen".

## Safety

People can report and block each other from a chat, a voice room, or the Discover feed.
Reports arrive in Supabase: **Table Editor → user_reports**, with the end of the
conversation. Sign-up asks people to confirm they're 13 or older.
