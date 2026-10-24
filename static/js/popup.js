// THE WORD POPUP (hover a word to translate it) and REPORTING bad translations.

// ---------- WORD POPUP ----------
// Hover over a word (or tap it on a phone) to see a short translation,
// the language it's in, and buttons to save it or report a bad translation.
let popupWord = null;   // the word the popup is showing: { word, sentence, language, translation }
let showTimer, hideTimer;
const translationCache = {}; // remembers translations, so hovering the same thing twice is instant

function attachWordPopup(span, word, sentence, language, index) {
  if (!word) return; // e.g. a lonely "?" or emoji
  const open = () => openWordPopup(span, word, sentence, language, index);
  span.onmouseenter = () => {
    clearTimeout(hideTimer);
    showTimer = setTimeout(open, 300); // small delay, so moving the mouse across text doesn't flash popups
  };
  span.onmouseleave = () => {
    clearTimeout(showTimer);
    hidePopupSoon();
  };
  span.onclick = open; // phones have no hover
}

// The part of the sentence around a word: everything between the nearest
// punctuation marks (Western and Japanese/Chinese ones) before and after it.
// "Ayer fui al mercado, y compré manzanas." + "compré" -> "y compré manzanas"
const CLAUSE_BREAKS = /[,.!?;:\n。、！？；，…]/;

function clauseAround(text, index) {
  let start = index;
  let end = index;
  while (start > 0 && !CLAUSE_BREAKS.test(text[start - 1])) start--;
  while (end < text.length && !CLAUSE_BREAKS.test(text[end])) end++;
  return text.slice(start, end).trim();
}

// Turn a dictionary entry into what the popup shows:
//   main:    "to summon, to call"
//   grammar: "verb · first-person singular present indicative of llamar"
function dictionaryMeaning(entry) {
  if (!entry) return null;
  const part = (entry.part || "").toLowerCase();
  if (entry.base) {
    // A conjugated / plural form: show what the BASE word means, and which form this is
    return { main: entry.base_meanings[0], grammar: [part, entry.form_of].filter(Boolean).join(" · ") };
  }
  const also = entry.meanings[1] ? `also: ${entry.meanings[1]}` : "";
  return { main: entry.meanings[0], grammar: [part, also].filter(Boolean).join(" · ") };
}

// Ask the server to translate a word or phrase (each one only once)
function translateText(text, sentence, language) {
  const key = text + "|" + sentence;
  translationCache[key] ??= api("/api/translate-word", {
    method: "POST",
    body: JSON.stringify({ word: text, sentence, language }),
  });
  return translationCache[key];
}

// Moving the mouse from the word INTO the popup shouldn't close it
el("wordPopup").onmouseenter = () => clearTimeout(hideTimer);
el("wordPopup").onmouseleave = hidePopupSoon;

// Clicking anywhere else closes the popup
document.addEventListener("click", event => {
  if (!event.target.closest("#wordPopup, .word")) el("wordPopup").hidden = true;
});

function hidePopupSoon() {
  hideTimer = setTimeout(() => (el("wordPopup").hidden = true), 300);
}

async function openWordPopup(span, word, sentence, language, index) {
  clearTimeout(hideTimer);
  const saved = deck[word];
  const showing = { word, sentence, language, translation: saved ? saved.translation : null };
  popupWord = showing;

  // The phrase around the word (not shown if the phrase IS just the word)
  const phrase = clauseAround(sentence, index);
  const showPhrase = phrase.length > 0 && clean(phrase) !== word;
  showing.phrase = phrase; // for the speaker button

  el("popupWord").textContent = word;
  el("popupLang").textContent = language || "";
  el("popupTranslation").textContent = saved ? saved.translation || "(no translation)" : "Translating...";
  el("popupGrammar").textContent = saved && saved.explanation ? saved.explanation : "";
  el("popupGrammar").hidden = !(saved && saved.explanation);
  el("popupPhraseBox").hidden = !showPhrase;
  el("popupPhrase").textContent = `"${phrase}"`;
  el("popupPhraseTranslation").textContent = "...";
  el("popupAddBtn").innerHTML = saved ? icon("check") + " In your deck" : "+ Add to deck";
  el("popupAddBtn").disabled = !!saved;
  placePopup(span);

  // Translate the word and the phrase at the same time
  const [wordResult, phraseResult] = await Promise.all([
    saved ? null : translateText(word, sentence, language),
    showPhrase ? translateText(phrase, sentence, language) : null,
  ]);
  if (popupWord !== showing) return; // the mouse already moved to another word

  if (wordResult) {
    const meaning = dictionaryMeaning(wordResult.dictionary);
    // The dictionary's meaning if it has one (better for single words), otherwise DeepL's
    showing.translation = meaning ? meaning.main : wordResult.translation;
    showing.explanation = meaning ? meaning.grammar : null; // saved on the card, shown when studying
    showing.language = wordResult.language || language;
    el("popupTranslation").textContent = showing.translation || "(no translation found)";
    el("popupGrammar").textContent = meaning ? meaning.grammar : "";
    el("popupGrammar").hidden = !meaning;
    el("popupLang").textContent = wordResult.language || "";
  }
  if (phraseResult) {
    el("popupPhraseTranslation").textContent = phraseResult.translation || "(no translation found)";
  }
  placePopup(span); // the popup got taller, so place it again
}

// Put the popup just above the word (or below it, if there's no room above)
function placePopup(span) {
  const popup = el("wordPopup");
  popup.hidden = false;
  const word = span.getBoundingClientRect();
  const left = Math.min(Math.max(8, word.left), window.innerWidth - popup.offsetWidth - 8);
  let top = word.top - popup.offsetHeight - 8;
  if (top < 8) top = word.bottom + 8;
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

el("popupAddBtn").onclick = async () => {
  const { word, sentence, translation, language, explanation } = popupWord;
  el("popupAddBtn").disabled = true;
  await saveWord(word, sentence, translation, language, explanation);
  el("popupAddBtn").innerHTML = icon("check") + " In your deck";
};

el("popupReportBtn").onclick = () => {
  el("wordPopup").hidden = true;
  openReport(popupWord.word, popupWord.translation, popupWord.sentence);
};


// ---------- REPORT A WRONG TRANSLATION ----------
let reporting = null; // { word, shown, sentence }

function openReport(word, shown, sentence) {
  reporting = { word, shown, sentence };
  el("reportWord").textContent = word;
  el("reportShown").textContent = shown || "(nothing)";
  el("reportSuggestion").value = "";
  el("reportNote").value = "";
  el("reportDialog").showModal(); // opens the pop-up window and darkens the page
}

el("reportCancelBtn").onclick = () => el("reportDialog").close();

el("reportForm").onsubmit = async event => {
  event.preventDefault();
  await api("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      word: reporting.word,
      shown_translation: reporting.shown,
      suggested_translation: el("reportSuggestion").value.trim(),
      note: el("reportNote").value.trim(),
      sentence: reporting.sentence,
    }),
  });
  el("reportDialog").close();
  showToast("Thanks! The developers will review it.");
};
