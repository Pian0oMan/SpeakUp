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
  hangUp: '<path d="M3 14.5c5-4.5 13-4.5 18 0l-2.3 2.6-3.6-1.3v-2.3a10 10 0 0 0-6.2 0v2.3l-3.6 1.3z"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 2.5 3 .5-2.5-.5-5.5.5-8z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
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

// COUNTRIES: stored as 2-letter codes ("JP"). The browser knows every country's name
// (Intl.DisplayNames), and flagcdn.com has a free flag picture for each one.
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT " +
  "BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH " +
  "ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS " +
  "LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG " +
  "NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD " +
  "SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code) {
  try {
    return countryNames.of(code);
  } catch {
    return code;
  }
}

// A small flag + the country name, e.g. [flag] Japan. Nothing if no country is picked.
function countryTag(code) {
  const tag = document.createElement("span");
  tag.className = "country-tag";
  if (!code) return tag;
  const flag = document.createElement("img");
  flag.className = "flag";
  flag.src = `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
  flag.alt = "";
  flag.onerror = () => flag.remove(); // no picture? just show the name
  tag.append(flag, countryName(code));
  return tag;
}

// Fill every country dropdown, sorted by name
document.querySelectorAll(".country-select").forEach(select => {
  select.add(new Option("Choose your country", ""));
  COUNTRY_CODES.map(code => [countryName(code), code])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name, code]) => select.add(new Option(name, code)));
});

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
el("obLearning").value = "Spanish";

// Language PAIRS ("I speak" + "I'm learning"): the language picked on one side
// is blocked (greyed out) on the other side, so they can never be the same.
const LANGUAGE_PAIRS = [
  ["obNative", "obLearning"],
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

// Read the Profile page's fields
function readProfileForm(prefix) {
  return {
    username: el(prefix + "Name").value.trim(),
    native: el(prefix + "Native").value,
    learning: el(prefix + "Learning").value,
    translate_to: el(prefix + "Translate").value,
    country: el(prefix + "Country").value || null,
    fluency: el(prefix + "Fluency").value || null,
    studying_for: el(prefix + "Studying").value || null,
    interests: pickedInterests(el(prefix + "Interests")),
  };
}

// ---------- LEVEL + INTERESTS (from the welcome questions) ----------
// The answers people can pick. The server checks against the same lists (account.py).
const FLUENCY_LABELS = {
  beginner: "Beginner", elementary: "Elementary", intermediate: "Intermediate", advanced: "Advanced",
};
const STUDYING_FOR_LABELS = {
  just_started: "Just starting", under_6_months: "Less than 6 months", "6_to_12_months": "6 to 12 months",
  "1_to_3_years": "1 to 3 years", over_3_years: "More than 3 years",
};
const INTERESTS = {
  anime: "Anime & manga", music: "Music", gaming: "Gaming", movies: "Movies & TV", books: "Books",
  travel: "Travel", food: "Food & cooking", sports: "Sports", fitness: "Fitness", art: "Art & design",
  photography: "Photography", tech: "Technology", science: "Science", history: "History",
  fashion: "Fashion", nature: "Nature & animals", kpop: "K-pop & J-pop", business: "Business",
  languages: "Languages", memes: "Memes & internet",
};
const MAX_INTERESTS = 10;

// Fill the Profile page's level dropdowns
el("profFluency").add(new Option("Not set", ""));
Object.entries(FLUENCY_LABELS).forEach(([value, label]) => el("profFluency").add(new Option(label, value)));
el("profStudying").add(new Option("Not set", ""));
Object.entries(STUDYING_FOR_LABELS).forEach(([value, label]) => el("profStudying").add(new Option(label, value)));

// An interest picker: one chip per topic, click to pick / unpick.
// onChange runs after every click (e.g. to update "Pick 2 more").
function fillInterestPicker(box, chosen = [], onChange = () => {}) {
  box.innerHTML = "";
  Object.entries(INTERESTS).forEach(([value, label]) => {
    const chip = document.createElement("button");
    chip.type = "button"; // inside a form, a plain button would submit it
    chip.className = "chip-pick" + (chosen.includes(value) ? " on" : "");
    chip.dataset.value = value;
    chip.textContent = label;
    chip.onclick = () => {
      if (!chip.classList.contains("on") && pickedInterests(box).length >= MAX_INTERESTS) {
        showToast(`You can pick up to ${MAX_INTERESTS}`);
        return;
      }
      chip.classList.toggle("on");
      onChange();
    };
    box.appendChild(chip);
  });
}

function pickedInterests(box) {
  return [...box.querySelectorAll(".chip-pick.on")].map(chip => chip.dataset.value);
}

// Which of someone's interests do I share?
function sharedInterests(interests) {
  const mine = (profile && profile.interests) || [];
  return (interests || []).filter(topic => mine.includes(topic));
}

// "Music, Travel and Food & cooking"
function interestList(topics) {
  const names = topics.map(topic => INTERESTS[topic] || topic);
  return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names.join("");
}

// LEVEL FLAMES: the higher the level, the bigger and hotter the flame.
// Like real fire: red embers, then orange, then yellow, and blue is the hottest.
const LEVEL_FLAMES = {
  beginner: { size: 0.55, outer: "#dc2626", inner: "#fca5a5" },
  elementary: { size: 0.7, outer: "#f97316", inner: "#fed7aa" },
  intermediate: { size: 0.85, outer: "#facc15", inner: "#fef9c3" },
  advanced: { size: 1, outer: "#3b82f6", inner: "#dbeafe" },
};

// A flame for a level, at most px pixels tall. grow = false keeps every level the
// same size (only the color changes), for small tags where a tiny flame would vanish.
function levelFlame(fluency, px = 36, grow = true) {
  const flame = LEVEL_FLAMES[fluency];
  if (!flame) return "";
  const size = grow ? Math.round(px * flame.size) : px;
  return `<svg class="level-flame" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <path fill="${flame.outer}" d="M12 1.5c.8 3.6 3.2 5.6 4.9 7.8 1.5 1.9 2.6 4 2.6 6.5 0 4.2-3.4 6.7-7.5 6.7s-7.5-2.5-7.5-6.7c0-2.9 1.5-5 3.2-6.6.2 1.9 1 3.1 2.2 3.6-.3-4.1.7-8.2 2.1-11.3z"/>
    <path fill="${flame.inner}" d="M12 11c.6 2 2.6 3.2 2.6 5.6a2.6 2.6 0 0 1-5.2 0c0-1.9 1.8-3.3 2.6-5.6z"/>
  </svg>`;
}

// Draw the flames on the welcome question's level cards
document.querySelectorAll(".flame-box[data-fluency]").forEach(box => (box.innerHTML = levelFlame(box.dataset.fluency)));

// "Intermediate" as a small tag with its flame (how well they speak the language they're learning)
function fluencyTag(fluency) {
  const tag = document.createElement("span");
  tag.className = "fluency-tag";
  tag.innerHTML = levelFlame(fluency, 13, false);
  tag.append(FLUENCY_LABELS[fluency] || "");
  return tag;
}

// Someone's interests as small chips, shared ones first and highlighted
function interestChips(interests, limit = 6) {
  const box = document.createElement("div");
  box.className = "interest-chips";
  const shared = sharedInterests(interests);
  const rest = (interests || []).filter(topic => !shared.includes(topic));
  [...shared, ...rest].slice(0, limit).forEach(topic => {
    const chip = document.createElement("span");
    chip.className = "interest-chip" + (shared.includes(topic) ? " shared" : "");
    chip.textContent = INTERESTS[topic] || topic;
    if (shared.includes(topic)) chip.title = "You both like this";
    box.appendChild(chip);
  });
  return box;
}
