// CONVERSATION RECAP: when a 1-on-1 chat or a voice room ends, a short summary:
// how long it was, how much I wrote and spoke, and the words I looked up,
// ready to add to a deck in one click.

let session = null; // the conversation going on now, e.g.
                    // { title: "with Yuki", started: 1730000000000, sent: 4, spokenMs: 52000, lookups: Map }
let recapWords = []; // the words the recap is showing

function startSession(title) {
  endSession(); // a conversation that was still going (e.g. straight from a room into a call)
  session = { title, started: Date.now(), sent: 0, spokenMs: 0, lookups: new Map() };
}

// Things that happen during a conversation
function noteSentMessage() {
  if (session) session.sent++;
}
function noteSpeech(ms) { // from talking.js, while my mic hears me
  if (session) session.spokenMs += ms;
}
function noteLookup(word) { // from the word popup: { word, sentence, translation, language, explanation }
  if (session && word.word && !deck[word.word]) session.lookups.set(word.word, word);
}

// Logging out: no recap
function discardSession() {
  session = null;
}

// The conversation ended: show the recap, if there's something worth showing
function endSession() {
  const ended = session;
  session = null;
  if (!ended) return;
  sendSpeech(); // save the last seconds of speaking time right away
  const minutes = (Date.now() - ended.started) / 60000;
  const words = [...ended.lookups.values()].filter(word => !deck[word.word]); // not saved in the meantime
  if (minutes < 0.5 || (!ended.sent && !words.length && ended.spokenMs < 10000)) return;
  showRecap(ended, words, minutes);
}

function showRecap(ended, words, minutes) {
  el("recapTitle").textContent = `Nice talk ${ended.title}!`;

  const stat = (iconName, value, label) => {
    const box = document.createElement("div");
    box.className = "recap-stat";
    box.innerHTML = icon(iconName);
    const strong = document.createElement("strong");
    strong.textContent = value;
    const small = document.createElement("span");
    small.textContent = label;
    box.append(strong, small);
    return box;
  };
  el("recapStats").replaceChildren(
    stat("chat", `${Math.max(1, Math.round(minutes))} min`, "together"),
    stat("check", String(ended.sent), ended.sent === 1 ? "message sent" : "messages sent"),
    stat("mic", spokenText(ended.spokenMs / 1000), "you spoke"),
  );

  // The looked-up words, all ticked: untick the ones I don't want
  recapWords = words;
  el("recapWordsBox").hidden = words.length === 0;
  el("recapAddBtn").hidden = words.length === 0;
  el("recapAddBtn").disabled = false;
  el("recapAddBtn").textContent = `Add ${words.length} to deck`;
  el("recapWords").replaceChildren(...words.map((word, index) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.dataset.index = index;
    box.onchange = updateRecapButton;
    const strong = document.createElement("strong");
    strong.textContent = word.word;
    const meaning = document.createElement("span");
    meaning.textContent = word.translation || "";
    label.append(box, strong, meaning);
    li.appendChild(label);
    return li;
  }));
  el("recapDeck").replaceChildren(...decks.map(d => new Option(d.name, d.id)));
  el("recapDeck").value = el("deckSelect").value || (decks[0] && decks[0].id);
  el("recapDialog").showModal();
}

function updateRecapButton() {
  const count = el("recapWords").querySelectorAll("input:checked").length;
  el("recapAddBtn").textContent = `Add ${count} to deck`;
  el("recapAddBtn").disabled = count === 0;
}

// e.g. "0 min", "under 1 min", "12 min"
function spokenText(seconds) {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return "under 1 min";
  return `${Math.round(seconds / 60)} min`;
}

// Save the ticked words, one after another, then redraw the decks once
el("recapAddBtn").onclick = async () => {
  const chosen = [...el("recapWords").querySelectorAll("input:checked")].map(box => recapWords[box.dataset.index]);
  el("recapAddBtn").disabled = true;
  el("recapAddBtn").textContent = "Adding...";
  for (const word of chosen) {
    await api("/api/flashcards", {
      method: "POST",
      body: JSON.stringify({
        word: word.word,
        sentence: word.sentence,
        translation: word.translation,
        language: word.language,
        explanation: word.explanation,
        color: el("colorPicker").value,
        deck_id: Number(el("recapDeck").value),
      }),
    }).catch(() => {});
  }
  el("recapDialog").close();
  showToast(`Added ${chosen.length} ${chosen.length === 1 ? "word" : "words"} to your deck`);
  loadDeck();
};
