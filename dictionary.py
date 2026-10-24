# DICTIONARY: English meanings of single words, from Wiktionary (free, no key needed).
#
# DeepL is great at translating SENTENCES, but weak at single words
# (it turned "nada" into "nothing nothing", and "que" into "because").
# A real dictionary knows every meaning of a word, its part of speech,
# and which verb a conjugated form comes from ("llamo" -> form of "llamar").
#
# Wiktionary writes its definitions in English, so this is used when the
# user wants translations in English.
import html
import re
from functools import lru_cache
from urllib.parse import quote

import requests

API = "https://en.wiktionary.org/api/rest_v1/page/definition/{}"
# Wikimedia asks every app to say who it is: a name, a version, and where to find it.
# Apps that don't are slowed down or blocked.
HEADERS = {"User-Agent": "SpeakUp/1.0 (language-learning school project; https://github.com/Pian0oMan/SpeakUp)"}
LANGUAGE_CODES = {"English": "en", "Spanish": "es", "French": "fr", "German": "de",
                  "Japanese": "ja", "Chinese": "zh", "Russian": "ru"}
# "first-person singular present indicative of llamar" -> the word after " of " is the base word
FORM_OF = re.compile(r"(singular|plural|participle|gerund|infinitive|feminine|masculine|form|tense|imperative)"
                     r"[^;]*? of ([^\s,;.()]+)\s*$", re.I)


def clean(definition):
    """Definitions are bits of HTML: turn them into plain text."""
    text = re.sub(r"<[^>]+>", "", definition)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


@lru_cache(maxsize=5000)  # remember lookups: each word is only fetched once
def fetch_entries(word, code):
    """Wiktionary's entries for a word in one language (or None)."""
    for spelling in dict.fromkeys([word, word.lower(), word.capitalize()]):  # German nouns are capitalized
        try:
            response = requests.get(API.format(quote(spelling)), headers=HEADERS, timeout=4)
        except requests.RequestException:
            return None
        if response.ok and response.json().get(code):
            return response.json()[code]
    return None


PARSE_API = "https://en.wiktionary.org/w/api.php"
SECTION_NAMES = {"English": "English", "Spanish": "Spanish", "French": "French", "German": "German",
                 "Japanese": "Japanese", "Chinese": "Chinese", "Russian": "Russian"}


@lru_cache(maxsize=5000)
def recording(word, language):
    """A REAL PERSON saying this word, from Wiktionary / Wikimedia Commons (free).
    Returns a link to the audio file, or None if nobody has recorded it."""
    section_name = SECTION_NAMES.get(language)
    if not section_name or not word or " " in word.strip() or len(word) > 30:
        return None
    word = word.strip()
    # Deck words are saved in lowercase, but German nouns are capitalized ("Hund"): try both
    for spelling in dict.fromkeys([word, word.capitalize()]):
        try:
            response = requests.get(PARSE_API, headers=HEADERS, timeout=5, params={
                "action": "parse", "page": spelling, "prop": "text", "format": "json", "formatversion": 2})
            page = response.json().get("parse", {}).get("text", "")
        except (requests.RequestException, ValueError):
            return None
        # The page has one section per language, each starting with <h2 id="Spanish"> etc.
        # Only use recordings from the RIGHT language's section.
        section = next((part for part in page.split('<h2 id="') if part.startswith(section_name + '"')), "")
        files = re.findall(r'src="(//upload\.wikimedia\.org/[^"]+\.(?:mp3|ogg|oga|opus|wav))"', section)
        if files:
            # MP3 plays in every browser (Safari doesn't play .ogg), so prefer it
            best = next((f for f in files if f.endswith(".mp3")), files[0])
            return "https:" + best
    return None


def lookup(word, language, follow_base=True):
    """e.g. lookup("nada", "Spanish") ->
    {"part": "Pronoun", "meanings": ["nothing, zero, zilch"], "form_of": None, "base": None, ...}
    lookup("llamo", "Spanish") ->
    {"form_of": "first-person singular present indicative of llamar",
     "base": "llamar", "base_meanings": ["to call", "to name"], ...}"""
    code = LANGUAGE_CODES.get(language)
    if not code or not word or " " in word.strip() or len(word) > 30:
        return None
    entries = fetch_entries(word.strip(), code)
    if not entries:
        return None
    for entry in entries:
        if entry.get("partOfSpeech") == "Romanization":
            continue  # e.g. "nada" as Japanese romaji: not a real meaning
        meanings = [clean(d.get("definition", "")) for d in entry.get("definitions", [])]
        meanings = [m for m in meanings if m][:3]
        if not meanings:
            continue
        result = {"part": entry.get("partOfSpeech"), "meanings": meanings,
                  "form_of": None, "base": None, "base_meanings": []}
        # A conjugated / plural / ... form: also get the meaning of the base word
        match = FORM_OF.search(meanings[0])
        if match and follow_base:
            base = lookup(match.group(2), language, follow_base=False)
            if base:
                # Only the base word's FIRST meaning: it's the main one (later ones can be
                # rare or slang, e.g. "amigo" has a vulgar second meaning)
                result.update(form_of=meanings[0], base=match.group(2), base_meanings=base["meanings"][:1])
        return result
    return None
