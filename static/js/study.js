// STUDY MODE: one flashcard at a time, with SPACED REPETITION.
// Each card comes back right before you'd forget it. After the answer you pick
// "Don't know" or "Know it", and the server works out when to show it next
// (see backend/review.py). Remembered cards come back later and later.

// ---------- WHICH CARDS ARE DUE ----------
const NEW_PER_DAY = 15; // new cards per day, so the reviews don't pile up

function startOfToday() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

// How many NEW cards I can still start today (across all my decks)
function newLeftToday() {
  const today = startOfToday();
  const started = Object.values(deck)
    .filter(card => card.first_studied_at && new Date(card.first_studied_at).getTime() >= today).length;
  return Math.max(0, NEW_PER_DAY - started);
}

// A study session: every card whose review time has come, plus a few new ones.
// (No due_at = never studied = new.)
function dueCards(cards) {
  const now = Date.now();
  const reviews = cards.filter(card => card.due_at && new Date(card.due_at).getTime() <= now);
  const fresh = cards.filter(card => !card.due_at).slice(0, newLeftToday());
  return { reviews, fresh };
}

function dueCount(cards) {
  const { reviews, fresh } = dueCards(cards);
  return reviews.length + fresh.length;
}

// The cards of one deck, or of ALL decks (id null = "Review all" on the home page)
function cardsOf(someDeck) {
  return Object.values(deck).filter(card => someDeck.id === null || card.deck_id === someDeck.id);
}

// Swap every card with a random card before it ("Fisher-Yates shuffle")
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}


// ---------- A STUDY SESSION ----------
let studyDeck = null;   // the deck being studied
let studyQueue = [];    // the cards still to come in this session
let studyCard = null;   // the card on the screen
let studyMode = "word"; // how it's asked (see pickMode)
let practicing = false; // nothing was due, so it's extra practice with every card
let reviewedCount = 0;
let forgottenCount = 0;
let answeredCount = 0;  // cards answered this time (each one is saved right away)
let studySession = null; // what I did this session, for the summary at the end (see newSession)

// XP per answer: the same numbers as XP_FOR in backend/progress.py
const XP_KNOW = 3;
const XP_DONT_KNOW = 1;

function newSession() {
  return {
    startedAt: Date.now(),
    known: 0,             // answers "Know it"
    forgot: 0,            // answers "Don't know"
    cards: new Set(),     // the different cards I answered
    newWords: new Set(),  // cards I saw for the very first time
    xp: 0,
  };
}

function startStudy(deckToStudy) {
  studyDeck = deckToStudy;
  const cards = cardsOf(deckToStudy);
  const { reviews, fresh } = dueCards(cards);
  practicing = reviews.length + fresh.length === 0;
  // Reviews first (shuffled), then the new cards in the order they were saved
  studyQueue = practicing ? shuffle([...cards]) : [...shuffle(reviews), ...fresh];
  reviewedCount = forgottenCount = answeredCount = 0;
  studySession = newSession();
  el("studyTitle").textContent = `${practicing ? "Practicing" : "Reviewing"}: ${deckToStudy.name}`;
  showView("studyView");
  nextStudyCard();
}

// New words are shown as they are. Words I've seen before are asked in different
// ways, because remembering a word is harder (and better practice) than recognizing it:
//   word:    see the word, remember what it means
//   meaning: see the meaning, remember the word
//   blank:   fill the word into the sentence it came from
//   listen:  hear the word, remember what it is
function pickMode(card) {
  if (!card.reps) return "word";
  const modes = ["word", "word", "listen"];
  if (card.translation) modes.push("meaning", "meaning");
  if (blankSentence(card)) modes.push("blank", "blank");
  return modes[Math.floor(Math.random() * modes.length)];
}

// "Me senté en el banco" + banco -> "Me senté en el _____" (null if the word isn't in it)
function blankSentence(card) {
  if (!card.example) return null;
  const index = card.example.toLowerCase().indexOf(card.word.toLowerCase());
  if (index < 0) return null;
  return card.example.slice(0, index) + "_____" + card.example.slice(index + card.word.length);
}

const MODE_LABELS = {
  word: card => (card.reps || card.due_at ? "What does it mean?" : "New word"),
  meaning: card => `How do you say it${card.language ? " in " + card.language : ""}?`,
  blank: () => "Fill in the blank",
  listen: () => "Listen. Which word is it?",
};

function nextStudyCard() {
  studyCard = studyQueue.shift() || null;
  const done = !studyCard;
  el("studyCard").hidden = done;
  el("studyDone").hidden = !done;
  el("studyReportBtn").hidden = true;
  el("showAnswerBtn").hidden = done;
  el("gradeButtons").hidden = true;
  if (done) return showStudySummary();

  const card = studyCard;
  studyMode = pickMode(card);
  el("studyProgress").textContent = `${studyQueue.length + 1} left`;
  el("studyModeLabel").textContent = MODE_LABELS[studyMode](card);

  // THE QUESTION
  const prompt = { word: card.word, meaning: card.translation, blank: blankSentence(card), listen: "" }[studyMode];
  el("studyWord").textContent = prompt;
  el("studyWord").classList.toggle("sentence", studyMode === "meaning" || studyMode === "blank");
  el("studyHint").textContent = studyMode === "blank" ? card.translation || "" : "";
  // The speaker says the word, so it's only there when that doesn't give the answer away
  el("studySpeakWord").hidden = studyMode === "meaning" || studyMode === "blank";
  el("studySpeakWord").classList.toggle("huge", studyMode === "listen");

  // THE ANSWER (hidden until "Show answer")
  el("studyAnswerWord").textContent = card.word;
  el("studyAnswerWord").hidden = studyMode === "word";
  el("studyReading").textContent = card.reading || "";        // e.g. げんき for 元気
  el("studyTranslation").textContent = card.translation || "(no translation yet)";
  el("studyTranslation").hidden = studyMode === "meaning" || studyMode === "blank"; // already on screen
  el("studyExplanation").textContent = card.explanation || ""; // notes from the library / Anki deck
  el("studyExample").textContent = card.example ? `"${card.example}"` : "";
  el("studySpeakExample").hidden = !card.example;
  el("studyAnswer").hidden = true;
  setRing(el("studyRing"), card.proficiency);
  showCardPicture(card);

  loadPreviews(card);
  if (studyMode === "listen") speak(card.word, card.language);
}

// The card's picture, if it has one (hidden again if it can't be loaded)
function showCardPicture(card) {
  const picture = el("studyImage");
  const url = cardPictureUrl(card);
  picture.hidden = !url;
  picture.onerror = () => (picture.hidden = true);
  if (url) picture.src = url;
  else picture.removeAttribute("src");
}

function showAnswer() {
  el("studyAnswer").hidden = false;
  el("studySpeakWord").hidden = false;
  el("showAnswerBtn").hidden = true;
  el("gradeButtons").hidden = false;
  el("studyReportBtn").hidden = false;
}
el("showAnswerBtn").onclick = showAnswer;

// Under each button: when the card would come back, e.g. "Good · 3 days".
// The server works it out from the card's schedule (cards with the same schedule share it).
const previewCache = {};
async function loadPreviews(card) {
  document.querySelectorAll("#gradeButtons small").forEach(small => (small.textContent = ""));
  const params = new URLSearchParams({
    interval_days: card.interval_days || 0, ease: card.ease || 2.5, reps: card.reps || 0,
  }).toString();
  previewCache[params] ??= api("/api/review/previews?" + params).catch(() => ({}));
  const previews = await previewCache[params];
  if (studyCard !== card) return; // already on the next card
  document.querySelectorAll("#gradeButtons .grade").forEach(button => {
    button.querySelector("small").textContent = previews[button.dataset.grade] || "";
  });
}

// I picked "Don't know" or "Know it": go to the next card right away, and save in the background
async function gradeCard(grade) {
  const card = studyCard;
  if (!card || el("gradeButtons").hidden) return;
  reviewedCount++;
  answeredCount++;
  studySession.cards.add(card.id);
  if (!card.reps && !card.due_at) studySession.newWords.add(card.id);
  if (grade === "know") studySession.known++;
  else studySession.forgot++;
  studySession.xp += grade === "know" ? XP_KNOW : XP_DONT_KNOW;
  // Didn't know it: it comes back in a minute (see review.py), so I see it
  // again in THIS session, a few cards from now
  if (grade === "dont_know") {
    forgottenCount++;
    studyQueue.splice(Math.min(3, studyQueue.length), 0, card);
  }
  nextStudyCard();
  const result = await api(`/api/cards/${card.id}/review`, {
    method: "POST",
    body: JSON.stringify({ grade }),
    keepalive: true, // finishes saving even if I leave or close the tab right after
  }).catch(() => null);
  if (result && !result.error) Object.assign(card, result); // its new schedule, ring and status
}

document.querySelectorAll("#gradeButtons .grade").forEach(button => {
  button.onclick = () => gradeCard(button.dataset.grade);
});

// KEYBOARD: Space shows the answer, then 1 = Don't know, 2 = Know it
document.addEventListener("keydown", event => {
  if (el("studyView").hidden || el("studyCard").hidden || document.querySelector("dialog[open]")) return;
  if (event.target.closest("input, textarea, select")) return;
  if ((event.key === " " || event.key === "Enter") && !el("showAnswerBtn").hidden) {
    event.preventDefault();
    showAnswer();
  } else if (event.key === "1") {
    gradeCard("dont_know");
  } else if (event.key === "2") {
    gradeCard("know");
  }
});

// THE SUMMARY: how much I studied, the XP I got, how many I knew.
// Shown when the cards run out, and when I stop halfway (if I answered at least one).
function showStudySummary(stoppedEarly = false) {
  el("studyProgress").textContent = "";
  const answers = studySession.known + studySession.forgot;
  const accuracy = answers ? Math.round((studySession.known / answers) * 100) : 0;
  const seconds = Math.round((Date.now() - studySession.startedAt) / 1000);

  // The headline and the mascot depend on how it went
  const [title, mood] = !answers ? ["All done for now!", "happy"]
    : stoppedEarly ? ["Nice work!", "happy"]
    : accuracy >= 80 ? ["Amazing session!", "excited"]
    : accuracy >= 50 ? ["Session complete!", "excited"]
    : ["Good practice!", "determined"];
  el("doneTitle").textContent = title;
  el("doneMascot").innerHTML = mascot(mood, 100);
  const newWords = studySession.newWords.size;
  el("doneSubtitle").textContent = !answers ? "Nothing to review right now."
    : newWords ? `You met ${newWords} new ${newWords === 1 ? "word" : "words"}.`
    : stoppedEarly ? "Your progress is saved. Come back for the rest any time."
    : "Every card you review sticks a little longer.";

  // The numbers count up from 0, the bar fills up
  countUp(el("doneCards"), studySession.cards.size, n => n);
  countUp(el("doneXp"), studySession.xp, n => `+${n}`);
  countUp(el("doneTime"), seconds, formatDuration);
  el("doneKnown").textContent = studySession.known;
  el("doneForgot").textContent = studySession.forgot;
  countUp(el("doneAccuracy"), accuracy, n => `${n}%`);
  el("doneBarFill").style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => (el("doneBarFill").style.width = `${accuracy}%`)));
  document.querySelector("#studyDone .done-split").hidden = !answers;
  document.querySelector("#studyDone .done-stats").hidden = !answers;

  // When the next review is
  const comingBack = forgottenCount ? `${forgottenCount} ${forgottenCount === 1 ? "card comes" : "cards come"} back soon. ` : "";
  const next = cardsOf(studyDeck)
    .map(card => card.due_at && new Date(card.due_at).getTime())
    .filter(time => time && time > Date.now())
    .sort((a, b) => a - b)[0];
  el("studySummary").textContent = stoppedEarly ? "" : comingBack + (next ? `Next review ${timeUntil(next)}.` : "");

  el("studyAgainBtn").textContent = studyQueue.length ? `Keep going · ${studyQueue.length} left`
    : dueCount(cardsOf(studyDeck)) ? "Keep reviewing" : "Practice anyway";
}

// 75 -> "1:15"
function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Count a number up from 0 in about a second (straight to the end if motion is turned off)
function countUp(spot, target, format) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || target === 0) return (spot.textContent = format(target));
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / 900);
    const eased = 1 - Math.pow(1 - t, 3); // fast first, slow at the end
    spot.textContent = format(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// e.g. "in 5 min", "in 3 hours", "tomorrow", "in 4 days"
function timeUntil(time) {
  const minutes = Math.round((time - Date.now()) / 60000);
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// "Keep going" picks up where I stopped; otherwise it's a new session
el("studyAgainBtn").onclick = () => {
  if (studyQueue.length) {
    nextStudyCard();
  } else {
    startStudy(studyDeck);
  }
};

// Leave study mode: at the end, or halfway through. Cards I already answered still count:
// each one was saved the moment I answered it. Also runs when I leave with the sidebar.
function leaveStudy() {
  stopSpeaking(); // stop any pronunciation still playing
  renderDecks();     // so the rings and "due" counts show my new progress, on My Decks...
  renderHomeDecks(); // ...and on the home page
  const unfinished = studyCard !== null;
  if (unfinished && answeredCount > 0) {
    showToast(`Progress saved: ${answeredCount} ${answeredCount === 1 ? "card" : "cards"} reviewed`);
  }
  answeredCount = 0; // so the message isn't shown twice
}

function exitStudy() {
  showView("deckView"); // showView calls leaveStudy
}
el("studyBackBtn").onclick = exitStudy;

// "← Exit" halfway: if I answered anything, first show what I did (the card I was on waits for "Keep going")
el("studyExitBtn").onclick = () => {
  if (!studyCard || answeredCount === 0) return exitStudy();
  stopSpeaking();
  studyQueue.unshift(studyCard);
  studyCard = null;
  el("studyCard").hidden = true;
  el("showAnswerBtn").hidden = true;
  el("gradeButtons").hidden = true;
  el("studyReportBtn").hidden = true;
  el("studyDone").hidden = false;
  showStudySummary(true);
};
el("studyReportBtn").onclick = () => openReport(studyCard.word, studyCard.translation, studyCard.example);
