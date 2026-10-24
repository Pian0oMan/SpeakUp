# TRANSLATION: DeepL, and figuring out which language a message is in.
import re

import requests

from backend.setup import DEEPL_API_KEY


# ---------- TRANSLATION (DeepL) ----------
DEEPL_CODES = {
    "English": "EN-US", "Spanish": "ES", "French": "FR", "German": "DE",
    "Japanese": "JA", "Chinese": "ZH-HANS", "Russian": "RU",
}


# The codes DeepL uses for the language it DETECTS, e.g. "JA" -> "Japanese"
DEEPL_NAMES = {"EN": "English", "ES": "Spanish", "FR": "French", "DE": "German",
               "JA": "Japanese", "ZH": "Chinese", "RU": "Russian"}
SOURCE_CODES = {name: code for code, name in DEEPL_NAMES.items()}  # "Japanese" -> "JA"
# Other languages DeepL might DETECT (we can't match people in these yet, but we can name them)
DEEPL_NAMES.update({"PT": "Portuguese", "IT": "Italian", "NL": "Dutch", "PL": "Polish",
                    "SV": "Swedish", "KO": "Korean", "TR": "Turkish", "UK": "Ukrainian"})


def translate_detail(text, language, context="", source=None):
    """Translate text into language.
    Returns (translation, detected language name). translation is None if the
    text is already in that language.
    context = nearby text (chat lines or the sentence), so DeepL picks the right meaning.
    source  = the language the text is in, if we already know it (more accurate for single words)."""
    if not DEEPL_API_KEY:
        return None, None  # no key yet, so no translations
    if source == language:
        return None, source  # already in that language, no need to ask DeepL
    # Free DeepL keys end in ":fx" and use a different address
    url = "https://api-free.deepl.com/v2/translate" if DEEPL_API_KEY.endswith(":fx") \
        else "https://api.deepl.com/v2/translate"
    body = {
        "text": [text],
        "target_lang": DEEPL_CODES[language],
        "context": context,                         # free: not counted toward the quota
        "formality": "prefer_less",                 # casual chat tone, not textbook
        "model_type": "prefer_quality_optimized",   # DeepL's newer, smarter model
    }
    if source in SOURCE_CODES:
        body["source_lang"] = SOURCE_CODES[source]
    try:
        response = requests.post(url, headers={"Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}"},
                                 json=body, timeout=5)
        response.raise_for_status()  # turns error responses (bad key, etc.) into exceptions
    except requests.RequestException as error:
        print("Translation failed:", error)
        return None, None
    result = response.json()["translations"][0]
    detected = DEEPL_NAMES.get(result["detected_source_language"], result["detected_source_language"])
    # e.g. detected "ES" and target "ES": it's already Spanish, no subtitle needed
    if DEEPL_CODES[language].startswith(result["detected_source_language"]):
        return None, detected
    # Got the same text back: it was already in that language. (DeepL sometimes
    # guesses wrong on short messages, e.g. it thinks "I love ramen" is Swedish.)
    if result["text"].strip().lower() == text.strip().lower():
        return None, language
    translated = result["text"]
    if " " not in text.strip():
        # A single word sometimes comes back doubled ("nada" -> "nothing nothing"): fix that
        translated = re.sub(r"\b(\w+)(?: \1\b)+", r"\1", translated, flags=re.I)
    return translated, detected


LATIN_SCRIPT = {"English", "Spanish", "French", "German"}  # languages written with a, b, c...


def script_language(text, *likely):
    """Guess the language from the writing system alone. None = it uses a, b, c
    (could be English, Spanish, ...). likely = languages the person uses."""
    if re.search(r"[぀-ヿ]", text):        # hiragana / katakana
        return "Japanese"
    if re.search(r"[Ѐ-ӿ]", text):        # Cyrillic
        return "Russian"
    if re.search(r"[一-鿿]", text):        # Chinese characters (Japanese uses them too)
        return "Chinese" if "Chinese" in likely and "Japanese" not in likely else "Japanese"
    return None


def detect_language(text, sender, context=""):
    """Which language is a chat message in? It's almost always one of the sender's
    two languages, and the writing system usually tells us which one."""
    pair = [sender["native"], sender["learning"]]
    by_script = script_language(text, *pair)
    if by_script:
        return by_script
    latin = [language for language in pair if language in LATIN_SCRIPT]
    if len(latin) == 1:                            # e.g. English <-> Japanese: a, b, c means English
        return latin[0]
    # Both languages use a, b, c (e.g. English <-> Spanish): ask DeepL, but only
    # trust its answer if it's one of the sender's languages. Unknown beats wrong.
    target = next(language for language in DEEPL_CODES if language not in pair)
    _, detected = translate_detail(text, target, context)
    return detected if detected in pair else None


def translate(text, language, context=""):
    """Like translate_detail, but only returns the translation."""
    return translate_detail(text, language, context)[0]


def translate_for(person, text, context="", source=None):
    """Translate for one person: into their translation language. If the text is
    ALREADY in that language, try the language they're learning ("how to say it"),
    and then the language they speak (in case their settings point to the same language)."""
    detected = None
    tried = []
    for language in (person["translate_to"], person["learning"], person.get("native")):
        if not language or language in tried:
            continue
        tried.append(language)
        translation, found = translate_detail(text, language, context, source)
        detected = detected or found
        if translation:
            return translation, detected
    return None, detected
