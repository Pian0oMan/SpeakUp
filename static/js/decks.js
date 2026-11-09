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
  resetAnkiDialog();
  el("ankiDialog").showModal();
};
// Any "Cancel" / "Close" button closes the window it's in
document.querySelectorAll(".close-dialog").forEach(button => {
  button.onclick = () => button.closest("dialog").close();
});

el("newDeckForm").onsubmit = async event => {
  event.preventDefault();
  const name = el("newDeckName").value.trim();
  if (!name) return showToast("Give the deck a name."); // only spaces typed
  await api("/api/decks", { method: "POST", body: JSON.stringify({ name }) });
  el("newDeckDialog").close();
  showToast(`Created "${name}"`);
  loadDeck();
};

// "Delete deck" first asks in a pop-up, so one wrong click can't throw a deck away
let deckBeingDeleted = null;
function deleteDeck(deckToDelete) {
  deckBeingDeleted = deckToDelete;
  const count = Object.values(deck).filter(card => card.deck_id === deckToDelete.id).length;
  el("deleteDeckName").textContent = `"${deckToDelete.name}"`;
  el("deleteDeckText").textContent = count
    ? `Its ${count} ${count === 1 ? "card" : "cards"} and all your progress on them will be gone. This can't be undone.`
    : "This can't be undone.";
  el("deleteDeckDialog").returnValue = "";
  el("deleteDeckDialog").showModal();
}
// The dialog closes by itself (method="dialog"): returnValue says which button it was
el("deleteDeckDialog").onclose = async () => {
  const doomed = deckBeingDeleted;
  deckBeingDeleted = null;
  if (el("deleteDeckDialog").returnValue !== "delete" || !doomed) return;
  // Its pictures in Storage (the cards themselves are deleted with the deck)
  const pictures = Object.values(deck).filter(card => card.deck_id === doomed.id && card.image).map(card => card.image);
  await api("/api/decks/" + doomed.id, { method: "DELETE" });
  showToast(`Deleted "${doomed.name}"`);
  for (let start = 0; start < pictures.length; start += 100) {
    sb.storage.from(PICTURE_BUCKET).remove(pictures.slice(start, start + 100)).catch(() => {});
  }
  loadDeck();
};

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
// Every card has a proficiency from 0 to 100%: the longer I can go without forgetting it,
// the fuller the ring (a week = about half, two months = full, see backend/review.py).
// It fills up and goes red -> yellow -> green.
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
  return `Added ${result.added.toLocaleString()} cards to "${result.deck.name}"${skipped}`;
}

// ---------- ANKI IMPORT ----------
// An .apkg file is a ZIP: a small card database plus all the deck's pictures and sounds
// (often 100+ MB). The browser opens the ZIP itself (with the JSZip library) and uploads
// ONLY the card database, so even a huge anime deck takes seconds instead of minutes.
// The bar goes: open the file -> unpack the cards -> upload -> the server adds them
// -> the pictures. Pictures are SHRUNK here in the browser (to small WebP images, a few
// KB each) and go straight to Supabase Storage: our server never has to handle them.
// Sounds stay in Anki (they're big, and Speak Up can read words aloud itself).
const COLLECTION_FILES = ["collection.anki21b", "collection.anki21", "collection.anki2"];
const MAX_WHOLE_UPLOAD = 50 * 1024 * 1024; // the server's limit, if it has to get the whole file
let ankiBusy = false;
let importedDeck = null;
let creepTimer = null;

function resetAnkiDialog() {
  el("ankiStatus").textContent = "";
  el("ankiProgress").hidden = true;
  el("ankiDone").hidden = true;
  el("ankiFile").hidden = false;
  el("ankiFile").value = "";
  el("ankiImportBtn").hidden = false;
  el("ankiStudyBtn").hidden = true;
}

function setAnkiProgress(step, percent) {
  el("ankiProgress").hidden = false;
  if (step) el("ankiStep").textContent = step;
  el("ankiPercent").textContent = `${Math.round(percent)}%`;
  el("ankiBarFill").style.width = `${percent}%`;
}

// While the server works we can't know how far it is: creep slowly towards "to"
function creepTo(from, to) {
  clearInterval(creepTimer);
  let now = from;
  creepTimer = setInterval(() => setAnkiProgress(null, (now += (to - now) * 0.04)), 200);
}

// Load JSZip only when it's needed (the first import)
let jszipLoading = null;
function loadJSZip() {
  jszipLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => {
      jszipLoading = null; // try again next time
      reject(new Error("JSZip didn't load"));
    };
    document.head.appendChild(script);
  });
  return jszipLoading;
}

// The card database out of the .apkg, as { blob, name }, or null if the browser can't do it
async function extractCollection(file) {
  let JSZip;
  try {
    JSZip = await loadJSZip();
  } catch {
    return null; // e.g. the library didn't load: the server gets the whole file instead
  }
  setAnkiProgress("Opening the deck...", 3);
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("That doesn't look like an Anki deck (.apkg) file.");
  }
  const name = COLLECTION_FILES.find(n => zip.file(n));
  if (!name) throw new Error("No cards found in this file.");
  setAnkiProgress("Unpacking the cards...", 5);
  const bytes = await zip.file(name).async("uint8array", meta => setAnkiProgress(null, 5 + meta.percent * 0.15));
  // "media" says which file in the ZIP is which picture (the server reads it)
  const media = zip.file("media") ? new Blob([await zip.file("media").async("uint8array")]) : null;
  return { blob: new Blob([bytes]), name, media, zip };
}

// Upload with a progress bar (fetch can't report upload progress, XMLHttpRequest can)
function uploadWithProgress(form, from, to) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/import-anki");
    request.setRequestHeader("Authorization", "Bearer " + token);
    request.upload.onprogress = event => {
      if (event.lengthComputable) setAnkiProgress(null, from + (event.loaded / event.total) * (to - from));
    };
    request.upload.onload = () => {
      setAnkiProgress("Adding the cards to your decks...", to);
      creepTo(to, 38);
    };
    request.onload = () => {
      try {
        resolve(JSON.parse(request.responseText));
      } catch {
        resolve({ error: request.status === 413 ? "That file is too big (the limit is 50 MB)."
                                               : "Something went wrong on the server. Please try again." });
      }
    };
    request.onerror = () => reject(new Error("Couldn't reach the server. Check your connection and try again."));
    request.send(form);
  });
}

el("ankiForm").onsubmit = async event => {
  event.preventDefault();
  const file = el("ankiFile").files[0];
  if (!file || ankiBusy) return;
  ankiBusy = true;
  el("ankiStatus").textContent = "";
  el("ankiImportBtn").disabled = true;
  el("ankiFile").disabled = true;
  let result;
  try {
    const form = new FormData();
    form.append("name", file.name);
    const collection = await extractCollection(file);
    if (collection) {
      form.append("collection", collection.blob, collection.name);
      if (collection.media) form.append("media", collection.media, "media");
    } else if (file.size > MAX_WHOLE_UPLOAD) {
      throw new Error("Couldn't open this deck in the browser, and it's too big to upload whole. Check your connection and try again.");
    } else {
      form.append("file", file);
    }
    setAnkiProgress("Uploading...", 20);
    result = await uploadWithProgress(form, 20, 30);
    clearInterval(creepTimer);
    // The cards are saved: now the pictures (the cards work without them in the meantime)
    if (!result.error && result.pictures && result.pictures.length && collection) {
      loadDeck();
      result.picturesSaved = await uploadPictures(collection.zip, result.pictures);
    }
  } catch (error) {
    result = { error: error.message };
  }
  clearInterval(creepTimer);
  ankiBusy = false;
  el("ankiImportBtn").disabled = false;
  el("ankiFile").disabled = false;

  if (result.error) {
    el("ankiProgress").hidden = true;
    el("ankiStatus").textContent = result.error;
    return;
  }
  setAnkiProgress("Done!", 100);
  setTimeout(() => showAnkiDone(result), 300);
  loadDeck();
};

// ---------- PICTURES: shrink them here, upload them straight to Supabase Storage ----------
const PICTURE_BUCKET = "card-images";
const PICTURE_SIZE = 400;        // the longest side, in pixels (cards show them small)
const PICTURE_MAX = 100 * 1024;  // the bucket refuses anything bigger (see 13_card_images.sql)

// Any picture (jpg, png, gif = its first frame, webp) -> a small WebP (or JPEG, if the
// browser can't make WebP), usually 3 to 10 KB
async function shrinkCardPicture(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, PICTURE_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
  let small = await encode("image/webp", 0.6);
  if (!small || small.type !== "image/webp") small = await encode("image/jpeg", 0.7);
  if (small && small.size > PICTURE_MAX) small = await encode("image/jpeg", 0.45);
  return small && small.size <= PICTURE_MAX ? small : null;
}

// Shrink + upload every picture, 6 at a time. Returns how many made it.
async function uploadPictures(zip, pictures) {
  const storage = sb.storage.from(PICTURE_BUCKET);
  let done = 0;
  let saved = 0;
  let failedInARow = 0;
  let next = 0;
  const show = () => setAnkiProgress(
    `Adding pictures... ${done.toLocaleString()} / ${pictures.length.toLocaleString()}`,
    40 + (done / pictures.length) * 59);
  show();
  async function worker() {
    while (next < pictures.length && failedInARow < 8) { // 8 fails in a row: Storage isn't set up, stop
      const picture = pictures[next++];
      try {
        const original = zip.file(picture.zip);
        const small = original && (await shrinkCardPicture(await original.async("blob")));
        if (small) {
          const { error } = await storage.upload(picture.path, small, {
            contentType: small.type,
            cacheControl: "31536000", // a picture never changes: browsers can keep it for a year
            upsert: false,
          });
          if (error && !/exists|duplicate/i.test(error.message)) throw error;
          saved++;
        }
        failedInARow = 0;
      } catch (error) {
        failedInARow++;
        console.warn("Picture not uploaded:", picture.path, error);
      }
      done++;
      show();
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return saved;
}

// A card's picture, as a link (null if it has none)
function cardPictureUrl(card) {
  if (!card.image || !sb) return null;
  return sb.storage.from(PICTURE_BUCKET).getPublicUrl(card.image).data.publicUrl;
}

// "Added 2,075 cards to ..." + what was left out, and a "Study it now" button
function showAnkiDone(result) {
  importedDeck = result.deck;
  if (!el("ankiDialog").open) showToast(addedMessage(result)); // I closed the window while it worked
  el("ankiProgress").hidden = true;
  el("ankiFile").hidden = true;
  el("ankiImportBtn").hidden = true;
  el("ankiStudyBtn").hidden = result.added === 0;
  el("ankiDone").hidden = false;
  el("ankiDoneText").textContent = addedMessage(result);
  const notes = [];
  const left = (result.notes || 0) - result.added - result.skipped;
  if (left > 0) {
    notes.push(`${left} ${left === 1 ? "card had" : "cards had"} no word and meaning (like info pages), so ${left === 1 ? "it was" : "they were"} left out.`);
  }
  if (result.picturesSaved !== undefined) {
    const missed = (result.pictures || []).length - result.picturesSaved;
    notes.push(`${result.picturesSaved.toLocaleString()} pictures came along, shrunk to save space` +
      (missed > 0 ? ` (${missed.toLocaleString()} couldn't be added).` : "."));
    if (result.sounds) notes.push("The sounds stay in Anki.");
  } else if (result.images || result.sounds) {
    notes.push("The pictures and sounds stay in Anki: only the text came over.");
  }
  el("ankiDoneNote").textContent = notes.join(" ");
}

el("ankiStudyBtn").onclick = () => {
  el("ankiDialog").close();
  startStudy(decks.find(d => d.id === importedDeck.id) || importedDeck);
};

// Don't let Esc close the window in the middle of an import
el("ankiDialog").addEventListener("cancel", event => {
  if (ankiBusy) event.preventDefault();
});
