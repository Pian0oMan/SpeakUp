// STUDY MODE: one flashcard at a time.

// ---------- STUDY MODE ----------
let studyDeck = null;  // the deck being studied
let studyCards = [];   // its cards, in random order
let studyIndex = 0;    // which card we're on
let knownCount = 0;
let answeredCount = 0; // cards answered this time (each one is saved right away)

function startStudy(deckToStudy) {
  studyDeck = deckToStudy;
  studyCards = Object.values(deck).filter(card => card.deck_id === deckToStudy.id);
  // Shuffle: swap every card with a random card before it ("Fisher-Yates shuffle")
  for (let i = studyCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [studyCards[i], studyCards[j]] = [studyCards[j], studyCards[i]];
  }
  studyIndex = 0;
  knownCount = 0;
  answeredCount = 0;
  el("studyTitle").textContent = `Studying: ${deckToStudy.name}`;
  showView("studyView");
  showStudyCard();
}

function showStudyCard() {
  const done = studyIndex >= studyCards.length;
  el("studyCard").hidden = done;
  el("studyDone").hidden = !done;
  el("studyReportBtn").hidden = true;
  el("showAnswerBtn").hidden = done;
  el("stillLearningBtn").hidden = el("knowItBtn").hidden = true;
  if (done) {
    el("studyProgress").textContent = "";
    el("studySummary").textContent =
      `You knew ${knownCount} of ${studyCards.length} cards. ${studyCards.length - knownCount} to keep practicing.`;
    return;
  }
  const card = studyCards[studyIndex];
  el("studyProgress").textContent = `${studyIndex + 1} / ${studyCards.length}`;
  el("studyWord").textContent = card.word;
  el("studyReading").textContent = card.reading || "";        // e.g. げんき for 元気
  el("studyTranslation").textContent = card.translation || "(no translation yet)";
  el("studyExplanation").textContent = card.explanation || ""; // notes from the library / Anki deck
  el("studyExample").textContent = card.example ? `"${card.example}"` : "";
  el("studySpeakExample").hidden = !card.example;
  setRing(el("studyRing"), card.proficiency);
  el("studyAnswer").hidden = true;
}

el("showAnswerBtn").onclick = () => {
  el("studyAnswer").hidden = false;
  el("showAnswerBtn").hidden = true;
  el("stillLearningBtn").hidden = el("knowItBtn").hidden = false;
  el("studyReportBtn").hidden = false;
};

// Save how well I know the card (and its new proficiency), then go to the next one
async function answerCard(status) {
  const card = studyCards[studyIndex];
  const before = card.proficiency || 0;
  if (status === "known") {
    knownCount++;
    card.proficiency = Math.min(100, before + KNOW_IT_BONUS);
  } else {
    card.proficiency = Math.max(0, before - STILL_LEARNING_PENALTY);
  }
  card.status = status;
  studyIndex++;
  answeredCount++;
  showStudyCard();
  await api("/api/flashcards/" + encodeURIComponent(card.word), {
    method: "PATCH",
    body: JSON.stringify({ status, proficiency: card.proficiency }),
    keepalive: true, // finishes saving even if I leave or close the tab right after
  });
}

el("knowItBtn").onclick = () => answerCard("known");
el("stillLearningBtn").onclick = () => answerCard("learning");
el("studyAgainBtn").onclick = () => startStudy(studyDeck);

// Leave study mode: at the end, or halfway through. Cards I already answered still count:
// each one was saved the moment I answered it. Also runs when I leave with the sidebar.
function leaveStudy() {
  stopSpeaking(); // stop any pronunciation still playing
  renderDecks();     // so the rings show my new progress, on My Decks...
  renderHomeDecks(); // ...and on the home page
  const unfinished = studyIndex < studyCards.length;
  if (unfinished && answeredCount > 0) {
    showToast(`Progress saved: ${answeredCount} of ${studyCards.length} cards`);
  }
  answeredCount = 0; // so the message isn't shown twice
}

function exitStudy() {
  showView("deckView"); // showView calls leaveStudy
}
el("studyBackBtn").onclick = exitStudy;
el("studyExitBtn").onclick = exitStudy;
el("studyReportBtn").onclick = () => {
  const card = studyCards[studyIndex];
  openReport(card.word, card.translation, card.example);
};
