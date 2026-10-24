// DECKS + FLASHCARDS: saving words, the library, Anki import, customizing decks.

// ---------- FLASHCARDS + DECKS ----------
// 1. Ask the backend for MY decks and flashcards (both at once), then draw everything
async function loadDeck() {
  const [deckRows, cards] = await Promise.all([api("/api/decks"), api("/api/flashcards")]);
  decks = deckRows;
  deck = {};
  cards.forEach(card => (deck[card.word] = card));
  render();
}

// 2. Save a word into the chosen deck, with the translation the popup showed.
//    The sentence is saved too, as an example for studying.
async function saveWord(word, sentence, translation, language, explanation) {
  if (!word) return;
  const card = await api("/api/flashcards", {
    method: "POST",
    body: JSON.stringify({
      word,
      sentence,
      translation,
      language,
      explanation, // e.g. "verb · first-person singular present indicative of llamar"
      color: el("colorPicker").value,
      deck_id: Number(el("deckSelect").value),
    }),
  });
  showToast(card.translation ? `Saved "${word}" → ${card.translation}` : `Saved "${word}"`);
  await loadDeck();
}

// 3. Remove a word (HTTP DELETE)
async function deleteWord(word) {
  await api("/api/flashcards/" + encodeURIComponent(word), { method: "DELETE" });
  loadDeck();
}

// 4. Fix a translation (HTTP PATCH = change part of something)
async function editTranslation(word) {
  const newTranslation = prompt(`Translation for "${word}":`, deck[word].translation || "");
  if (newTranslation === null) return; // clicked Cancel
  await api("/api/flashcards/" + encodeURIComponent(word), {
    method: "PATCH",
    body: JSON.stringify({ translation: newTranslation.trim() }),
  });
  loadDeck();
}

// POP-UP WINDOWS: "+ New deck" and "Import Anki deck" open their own little window
document.querySelectorAll(".open-new-deck").forEach(button => {
  button.onclick = () => {
    el("newDeckName").value = "";
    el("newDeckDialog").showModal();
  };
});
el("openAnkiBtn").onclick = () => {
  el("ankiStatus").textContent = "";
  el("ankiDialog").showModal();
};
// Any "Cancel" / "Close" button closes the window it's in
document.querySelectorAll(".close-dialog").forEach(button => {
  button.onclick = () => button.closest("dialog").close();
});

el("newDeckForm").onsubmit = async event => {
  event.preventDefault();
  const name = el("newDeckName").value.trim();
  await api("/api/decks", { method: "POST", body: JSON.stringify({ name }) });
  el("newDeckDialog").close();
  showToast(`Created "${name}"`);
  loadDeck();
};

async function deleteDeck(deckToDelete) {
  if (!confirm(`Delete the deck "${deckToDelete.name}" and all its cards?`)) return;
  await api("/api/decks/" + deckToDelete.id, { method: "DELETE" });
  loadDeck();
}

// Small pop-up that disappears after 2.5 seconds
let toastTimer;
function showToast(text) {
  el("toast").textContent = text;
  el("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el("toast").hidden = true), 2500);
}

// Split a message into words. Intl.Segmenter (built into the browser) knows where
// words start and end in every language, even Japanese and Chinese, which don't
// put spaces between words: "公園のベンチに座った" -> 公園 | の | ベンチ | に | 座っ | た
const LOCALES = { English: "en", Spanish: "es", French: "fr", German: "de", Japanese: "ja", Chinese: "zh", Russian: "ru" };

function splitWords(text, language) {
  if (!window.Intl || !Intl.Segmenter) {
    // Very old browser: just split on spaces
    let index = 0;
    return text.split(/(\s+)/).map(part => {
      const piece = { segment: part, index, isWordLike: /\S/.test(part) };
      index += part.length;
      return piece;
    });
  }
  return [...new Intl.Segmenter(LOCALES[language], { granularity: "word" }).segment(text)];
}

// Turn "Hola!" into "hola" so punctuation doesn't matter
function clean(word) {
  return word.toLowerCase().replace(/[^\p{L}]/gu, "");
}


// ---------- PROFICIENCY RINGS ----------
// Every card has a proficiency from 0 to 100%. "Know it" in study mode adds 25,
// "Still learning" takes away 10. The ring fills up and goes red -> yellow -> green.
const KNOW_IT_BONUS = 25;
const STILL_LEARNING_PENALTY = 10;

function setRing(ring, percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  ring.style.setProperty("--p", p);                          // how much of the circle is filled
  ring.style.setProperty("--ring", `hsl(${p * 1.2}, 85%, 58%)`); // hue 0 = red, 60 = yellow, 120 = green
  ring.querySelector("span").textContent = p + "%";
  ring.title = `${p}% proficiency`;
}

function makeRing(percent) {
  const ring = document.createElement("div");
  ring.className = "ring";
  ring.appendChild(document.createElement("span"));
  setRing(ring, percent);
  return ring;
}


// ---------- CUSTOMIZE A DECK: name, color, picture ----------
const DECK_COLORS = ["#14b8a6", "#38bdf8", "#818cf8", "#c084fc", "#f472b6", "#fb7185", "#fb923c", "#facc15"];
let customizing = null; // { deck, color, image }: what the pop-up is editing right now

// The preset color buttons
DECK_COLORS.forEach(color => {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "color-choice";
  swatch.style.background = color;
  swatch.dataset.color = color;
  swatch.onclick = () => pickColor(color);
  el("colorChoices").insertBefore(swatch, el("colorChoices").lastElementChild);
});
el("customColor").oninput = () => pickColor(el("customColor").value);

function openCustomize(d) {
  customizing = { deck: d, color: d.color || null, image: d.image || null };
  el("customizeName").value = d.name;
  el("customColor").value = d.color || "#14b8a6";
  el("customizeStatus").textContent = "";
  updateCustomizePreview();
  el("customizeDialog").showModal();
}

function pickColor(color) {
  customizing.color = color;
  updateCustomizePreview();
}

// Show what the deck icon will look like, and which color is selected
function updateCustomizePreview() {
  const preview = deckIcon({ name: el("customizeName").value || "?", color: customizing.color, image: customizing.image });
  preview.classList.add("big");
  el("customizePreview").replaceChildren(preview);
  document.querySelectorAll(".color-choice").forEach(swatch => {
    swatch.classList.toggle("selected", swatch.dataset.color === customizing.color);
  });
  el("removePictureBtn").hidden = !customizing.image;
}
el("customizeName").oninput = updateCustomizePreview;

// A picture: shrink it to a 160x160 square in the browser, so it's tiny to store
el("pictureFile").onchange = async () => {
  const file = el("pictureFile").files[0];
  el("pictureFile").value = ""; // so picking the same file again still works
  if (!file) return;
  try {
    customizing.image = await shrinkPicture(file, 160);
    updateCustomizePreview();
  } catch {
    el("customizeStatus").textContent = "That picture couldn't be opened.";
  }
};

function shrinkPicture(file, size) {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => {
      // Cut the biggest square out of the middle, then draw it at size x size
      const side = Math.min(picture.width, picture.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(picture,
        (picture.width - side) / 2, (picture.height - side) / 2, side, side, // from: middle square
        0, 0, size, size);                                                   // to: the whole canvas
      URL.revokeObjectURL(picture.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85)); // the picture as text: "data:image/jpeg;base64,..."
    };
    picture.onerror = reject;
    picture.src = URL.createObjectURL(file);
  });
}

el("removePictureBtn").onclick = () => {
  customizing.image = null;
  updateCustomizePreview();
};

el("customizeForm").onsubmit = async event => {
  event.preventDefault();
  const result = await api(`/api/decks/${customizing.deck.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: el("customizeName").value.trim(),
      color: customizing.color,
      image: customizing.image,
    }),
  });
  if (result.error) {
    el("customizeStatus").textContent = result.error;
    return;
  }
  el("customizeDialog").close();
  loadDeck();
};


// ---------- LIBRARY ----------
// Ready-made decks for everyone. "Add to my decks" copies one into my own decks.
async function openLibrary() {
  showView("libraryView");
  const box = el("libraryList");
  box.textContent = "Loading...";
  const libraryDecks = await api("/api/library");
  box.innerHTML = "";
  libraryDecks.forEach(libraryDeck => {
    const card = document.createElement("div");
    card.className = "room-card"; // same look as the room cards
    const name = document.createElement("h3");
    name.textContent = libraryDeck.name;
    const meta = document.createElement("div");
    meta.className = "room-meta";
    // e.g. [JA → EN] 112 cards
    meta.replaceChildren(languageTag(libraryDeck.language, libraryDeck.translation_language),
                         ` ${libraryDeck.count} cards`);
    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = libraryDeck.description || "";
    const preview = document.createElement("div");
    preview.className = "library-preview";
    preview.textContent = libraryDeck.preview.join(" · ") + (libraryDeck.count > 4 ? " ..." : "");
    const add = document.createElement("button");
    add.className = "primary small";
    add.textContent = "Add to my decks";
    add.onclick = async () => {
      add.disabled = true;
      const result = await api(`/api/library/${libraryDeck.id}/add`, { method: "POST" });
      add.textContent = "Added";
      showToast(addedMessage(result));
      loadDeck();
    };
    const top = document.createElement("div");
    top.className = "card-top";
    top.append(deckIcon(libraryDeck), name);
    card.append(top, meta, description, preview, add);
    box.appendChild(card);
  });
}
el("navLibrary").onclick = openLibrary;

// e.g. "Added 15 cards to "Japanese Greetings" (2 were already in your decks)"
function addedMessage(result) {
  if (result.error) return result.error;
  const skipped = result.skipped ? ` (${result.skipped} were already in your decks)` : "";
  return `Added ${result.added} cards to "${result.deck.name}"${skipped}`;
}

// ---------- ANKI IMPORT ----------
el("ankiForm").onsubmit = async event => {
  event.preventDefault();
  const file = el("ankiFile").files[0];
  if (!file) return;
  el("ankiStatus").textContent = "Importing... (big decks can take a little while)";
  // A file upload is sent as "form data", not JSON
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/import-anki", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });
  const result = await response.json();
  el("ankiStatus").textContent = addedMessage(result);
  el("ankiFile").value = "";
  loadDeck();
};
