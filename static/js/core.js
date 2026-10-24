// CORE: shared things every other file uses: my state, icons, language lists,
// the Socket.IO connection, and api() for talking to our server.

let sb;                  // Supabase client: handles logging in
let token = null;        // my login "ID card", sent to our server to prove who I am
let loggedIn = false;
let registering = false; // true while "Create account" is still saving the profile
let profile = null;      // my name + languages
let messages = [];       // chat messages with the current partner
let deck = {};           // word -> card, e.g. { "hola": { color: "#ffd54f", translation: "hello", deck_id: 3 } }
let decks = [];          // my decks, e.g. [{ id: 3, name: "My Words" }, { id: 4, name: "Food" }]
let partnerName = "";

const LANGUAGES = ["English", "Spanish", "French", "German", "Japanese", "Chinese", "Russian"];

// Shortcut so we don't type document.getElementById a hundred times
const el = id => document.getElementById(id);

// ICONS: one set of simple line icons, all drawn the same way (like Discord's).
// In the HTML, <span data-icon="mic"></span> gets the "mic" drawing put inside it.
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  rooms: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15c3 0 5 2 5 5"/>',
  decks: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  library: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M6 19h13"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/><path d="M3 3l18 18"/>',
  camera: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 10l6-3v10l-6-3"/>',
  cameraOff: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 10l6-3v10l-6-3"/><path d="M3 3l18 18"/>',
  next: '<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  sparkle: '<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 2.5 3 .5-2.5-.5-5.5.5-8z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};

function icon(name) {
  return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

// Draw every data-icon="..." in the page
document.querySelectorAll("[data-icon]").forEach(spot => (spot.innerHTML = icon(spot.dataset.icon)));

// Draw the mascot everywhere the HTML says data-mascot="mood" (see mascot.js)
document.querySelectorAll("[data-mascot]").forEach(spot => {
  spot.innerHTML = mascot(spot.dataset.mascot, Number(spot.dataset.size) || 80);
});

// An "empty" message with the mascot next to it, e.g. when there are no decks yet
function emptyState(mood, text) {
  return `<div class="empty-state">${mascot(mood, 48)}<span>${text}</span></div>`;
}

// Language tags like "EN → JA" (HelloTalk style)
const LANGUAGE_CODES = { English: "EN", Spanish: "ES", French: "FR", German: "DE", Japanese: "JA", Chinese: "ZH", Russian: "RU" };

function languageTag(native, learning) {
  const tag = document.createElement("span");
  tag.className = "lang-tag";
  tag.textContent = learning
    ? `${LANGUAGE_CODES[native] || native} → ${LANGUAGE_CODES[learning] || learning}`
    : LANGUAGE_CODES[native] || native;
  tag.title = learning ? `speaks ${native}, learning ${learning}` : native;
  return tag;
}

// Colorful deck icons (Renshuu style): the deck's picture if it has one, otherwise a
// rounded square with its first letter, in the color the user picked. With no color
// picked, the color comes from the deck's name, so each deck always gets the same one.
function deckIcon(someDeck) {
  const box = document.createElement("div");
  box.className = "deck-icon";
  if (someDeck.image) {
    const picture = document.createElement("img");
    picture.src = someDeck.image;
    picture.alt = "";
    box.appendChild(picture);
    return box;
  }
  box.style.background = someDeck.color || autoColor(someDeck.name);
  box.textContent = [...someDeck.name][0].toUpperCase();
  return box;
}

function autoColor(name) {
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.codePointAt(0)) % 360;
  return `hsl(${hash}, 65%, 55%)`;
}

// Fill every language dropdown from the list above (so we only write the list once)
document.querySelectorAll(".lang-select").forEach(select => {
  LANGUAGES.forEach(lang => select.add(new Option(lang, lang)));
});
el("regLearning").value = "Spanish";

// Language PAIRS ("I speak" + "I'm learning"): the language picked on one side
// is blocked (greyed out) on the other side, so they can never be the same.
const LANGUAGE_PAIRS = [
  ["regNative", "regLearning"],
  ["profNative", "profLearning"],
  ["matchNative", "matchLearning"],
];

function blockSameLanguage([firstId, secondId]) {
  const first = el(firstId), second = el(secondId);
  [...first.options].forEach(option => (option.disabled = option.value === second.value));
  [...second.options].forEach(option => (option.disabled = option.value === first.value));
}

LANGUAGE_PAIRS.forEach(pair => {
  pair.forEach(id => el(id).addEventListener("change", () => blockSameLanguage(pair)));
  blockSameLanguage(pair);
});

// When creating an account, translations default to the language you speak
el("regNative").addEventListener("change", () => (el("regTranslate").value = el("regNative").value));

// REAL-TIME: open an always-on connection to the server
const socket = io();

// Every screen is a <section class="screen">. Show one, hide the rest.
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(screen => (screen.hidden = screen.id !== id));
}

// Talk to OUR server (Flask), always including the login token
async function api(path, options = {}) {
  options.headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    "X-TZ-Offset": new Date().getTimezoneOffset(), // my time zone, so streaks reset at MY midnight
  };
  const response = await fetch(path, options);
  return response.json();
}

// Read the name + language fields of a form. prefix "reg" reads regName, regNative, ...
function readProfileForm(prefix) {
  return {
    username: el(prefix + "Name").value.trim(),
    native: el(prefix + "Native").value,
    learning: el(prefix + "Learning").value,
    translate_to: el(prefix + "Translate").value,
  };
}
