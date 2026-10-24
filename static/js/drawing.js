// DRAWING: putting messages, decks and the home page on the screen.

// ---------- DRAWING ----------
// Add a small line of text with a CSS class inside a message, e.g. a translation
function addLine(parent, className, text) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  parent.appendChild(line);
  return line; // so we can add more to it, e.g. an icon
}

// Put text into the page word by word. Every word can be hovered (translation popup)
// and gets its highlight color if it's in my deck. Used by chat messages AND captions.
function appendWords(container, text, language) {
  splitWords(text, language).forEach(part => {
    const span = document.createElement("span");
    span.textContent = part.segment;
    if (part.isWordLike) { // a real word (not a space or punctuation)
      span.className = "word";
      const key = clean(part.segment);
      // The highlight! Only for words I saved myself from conversations
      // (imported decks can have thousands of words, that would color everything)
      if (deck[key] && (deck[key].source || "chat") === "chat") {
        span.style.background = deck[key].color;
        span.classList.add("saved"); // dark text, so it's readable on the highlight color
      }
      // hover or tap: see what it means. part.index = where the word starts in the text
      attachWordPopup(span, key, text, language, part.index);
    }
    container.appendChild(span);
  });
}

// Draw the chat + deck on the page (DOM = the page as JS objects)
function render() {
  const box = el("messages");
  box.innerHTML = "";
  messages.forEach(msg => {
    const div = document.createElement("div");
    // System notices ("partner left") are plain grey text, not clickable words
    if (msg.from === "system") {
      div.className = "message system";
      div.textContent = msg.text;
      box.appendChild(div);
      return;
    }
    if (msg.from === "icebreaker") {
      div.className = "message icebreaker";
      addLine(div, "icebreaker-label", "Icebreaker").insertAdjacentHTML("afterbegin", icon("sparkle"));
    } else {
      // socket.id is MY connection id. If it matches, I sent this message.
      div.className = "message" + (msg.from === socket.id ? " me" : "");
    }
    if (msg.voice) addLine(div, "voice-label", "Spoken");
    appendWords(div, msg.text, msg.language);
    // The automatic translation, like a subtitle
    if (msg.translation) addLine(div, "translation", msg.translation);
    // Who has answered the question so far
    if (msg.from === "icebreaker") {
      const meDone = msg.answered.includes(socket.id) ? "answered" : "not yet";
      const partnerDone = msg.answered.some(id => id !== socket.id) ? "answered" : "not yet";
      addLine(div, "icebreaker-status", `You ${meDone} · ${partnerName} ${partnerDone}`);
    }
    // This message was someone's answer to an icebreaker
    if (msg.answer) addLine(div, "answer-badge", "Answer");
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight; // auto-scroll to the newest message


  renderDecks();
  renderHomeDecks();
  if (currentRoom) renderRoomMessages(); // so new deck words get highlighted in the room too
}

// My decks on the home page: name, number of cards, overall progress ring, Study button
function renderHomeDecks() {
  const box = el("homeDecks");
  box.innerHTML = "";
  if (decks.length === 0) {
    box.innerHTML = emptyState("idle", "No decks yet. Save words from your chats, or add one from the Library.");
    return;
  }
  decks.forEach(d => {
    const cards = Object.values(deck).filter(card => card.deck_id === d.id);
    // The deck's ring = the average proficiency of its cards
    const average = cards.length ? cards.reduce((sum, card) => sum + (card.proficiency || 0), 0) / cards.length : 0;
    // Two rows: [icon + full name] on top, [ring + card count + Study] at the bottom
    const tile = document.createElement("div");
    tile.className = "home-deck";
    const top = document.createElement("div");
    top.className = "home-deck-top";
    const icon = deckIcon(d);
    icon.title = "Customize";
    icon.onclick = () => openCustomize(d); // click the icon to change color / picture
    const name = document.createElement("strong");
    name.textContent = d.name; // the whole name, it wraps onto a second line if needed
    top.append(icon, name);

    const bottom = document.createElement("div");
    bottom.className = "home-deck-bottom";
    const count = document.createElement("span");
    count.textContent = `${cards.length} cards`;
    const study = document.createElement("button");
    study.className = "primary small";
    study.textContent = "Study";
    study.disabled = cards.length === 0;
    study.onclick = () => startStudy(d);
    bottom.append(makeRing(average), count, study);

    tile.append(top, bottom);
    box.appendChild(tile);
  });
}
el("seeAllDecksBtn").onclick = () => showView("deckView");

// Draw the "Save to" dropdown in the chat and one card per deck on the My Decks page
function renderDecks() {
  const select = el("deckSelect");
  const chosen = select.value;
  select.innerHTML = "";
  decks.forEach(d => select.add(new Option(d.name, d.id)));
  if (decks.some(d => String(d.id) === chosen)) select.value = chosen; // keep my choice

  const groups = el("deckGroups");
  groups.innerHTML = "";
  decks.forEach(d => {
    const cards = Object.values(deck).filter(card => card.deck_id === d.id);
    const box = document.createElement("div");
    box.className = "card";

    const head = document.createElement("div");
    head.className = "deck-head";
    const title = document.createElement("h3");
    title.className = "card-top";
    const count = document.createElement("span");
    count.textContent = `${cards.length} cards`;
    title.append(deckIcon(d), d.name, count);
    const study = document.createElement("button");
    study.className = "primary small";
    study.textContent = "Study";
    study.disabled = cards.length === 0;
    study.onclick = () => startStudy(d);
    const customize = document.createElement("button");
    customize.className = "ghost small";
    customize.textContent = "Customize";
    customize.onclick = () => openCustomize(d);
    const del = document.createElement("button");
    del.className = "danger-text";
    del.textContent = "Delete deck";
    del.onclick = () => deleteDeck(d);
    const buttons = document.createElement("div");
    buttons.className = "deck-head-buttons";
    buttons.append(study, customize, del);
    head.append(title, buttons);

    const list = document.createElement("ul");
    list.className = "deck-list";
    if (cards.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No words yet. Click words in a chat to save them here!";
      list.appendChild(li);
    }
    // Big imported decks can have thousands of cards: only list the first 50 here
    // (study mode still uses all of them)
    const SHOWN = 50;
    cards.slice(0, SHOWN).forEach(card => {
      const li = document.createElement("li");
      const word = document.createElement("span");
      word.className = "swatch";
      word.style.background = card.color;
      word.textContent = card.word;
      const ring = makeRing(card.proficiency); // how well I know it
      const translation = document.createElement("span");
      translation.className = "card-translation" + (card.translation ? "" : " missing");
      translation.textContent = card.translation || "add translation";
      translation.onclick = () => editTranslation(card.word);
      const remove = document.createElement("button");
      remove.className = "remove-btn";
      remove.innerHTML = icon("close");
      remove.title = "Delete card";
      remove.onclick = () => deleteWord(card.word);
      li.append(ring, word, translation, makeSpeakButton(card.word, card.language), remove);
      list.appendChild(li);
    });
    if (cards.length > SHOWN) {
      const more = document.createElement("li");
      more.className = "more-cards";
      more.textContent = `+ ${cards.length - SHOWN} more cards (press Study to see them all)`;
      list.appendChild(more);
    }

    box.append(head, list);
    groups.appendChild(box);
  });
}
