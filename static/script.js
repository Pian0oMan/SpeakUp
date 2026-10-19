// JAVASCRIPT = the BEHAVIOR. It reacts to clicks and talks to the backend.

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
  options.headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
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


// ---------- LOG IN + CREATE ACCOUNT (Supabase) ----------
async function start() {
  const config = await (await fetch("/api/config")).json();
  sb = supabase.createClient(config.url, config.anonKey);

  // Runs whenever login state changes: page load, log in, log out, token refresh
  sb.auth.onAuthStateChange((event, session) => {
    token = session ? session.access_token : null;
    if (session && !loggedIn && !registering) {
      enterApp();
    } else if (!session) {
      loggedIn = false;
      showScreen("loginScreen");
    }
  });
}

el("toRegister").onclick = event => {
  event.preventDefault(); // it's a link: don't jump to "#"
  showScreen("registerScreen");
};
el("toLogin").onclick = event => {
  event.preventDefault();
  showScreen("loginScreen");
};

el("loginForm").onsubmit = async event => {
  event.preventDefault();
  el("loginStatus").textContent = "Logging in...";
  const { error } = await sb.auth.signInWithPassword({
    email: el("loginEmail").value,
    password: el("loginPassword").value,
  });
  el("loginStatus").textContent = error ? error.message : "";
};

// Create account: languages are chosen HERE, once
el("registerForm").onsubmit = async event => {
  event.preventDefault();
  const status = el("registerStatus");
  const newProfile = readProfileForm("reg");
  if (el("regPassword").value !== el("regConfirm").value) {
    status.textContent = "The passwords don't match.";
    return;
  }
  if (newProfile.native === newProfile.learning) {
    status.textContent = "Pick two different languages!";
    return;
  }

  status.textContent = "Creating your account...";
  registering = true;
  const { data, error } = await sb.auth.signUp({
    email: el("regEmail").value,
    password: el("regPassword").value,
  });
  if (error || !data.session) {
    registering = false;
    status.textContent = error ? error.message : "Check your email to confirm your account, then log in.";
    return;
  }
  token = data.session.access_token;
  await api("/api/profile", { method: "PUT", body: JSON.stringify(newProfile) }); // save languages
  registering = false;
  status.textContent = "";
  enterApp();
};

el("logoutBtn").onclick = () => {
  leaveChat();
  sb.auth.signOut();
};


// ---------- MAIN MENU, PROFILE, DECK ----------
async function enterApp() {
  loggedIn = true;
  profile = await api("/api/profile");
  await loadDeck();
  if (profile) openMenu();
  else openProfile("Welcome! Pick your languages to get started."); // e.g. confirmed by email
}

// Show the app (sidebar + content) with one view: homeView, deckView or profileView
function showView(id) {
  showScreen("appScreen");
  document.querySelectorAll(".view").forEach(view => (view.hidden = view.id !== id));
  // Highlight the sidebar button for this view
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.view === id);
  });
}

function openMenu() {
  if (!profile) return openProfile("Save your profile first.");
  el("greeting").textContent = `Hi, ${profile.username} 👋`;
  el("matchNative").value = profile.native;
  el("matchLearning").value = profile.learning;
  blockSameLanguage(["matchNative", "matchLearning"]);
  el("learningStat").textContent = profile.learning;
  el("deckCount").textContent = Object.keys(deck).length;
  showView("homeView");
}

function openProfile(message) {
  if (profile) {
    el("profName").value = profile.username;
    el("profNative").value = profile.native;
    el("profLearning").value = profile.learning;
    el("profTranslate").value = profile.translate_to;
    blockSameLanguage(["profNative", "profLearning"]);
  }
  el("profileStatus").textContent = message;
  showView("profileView");
}

// Changing languages on the Quick Match banner saves them to my profile,
// so the server matches me with the new languages (and they're remembered next time)
["matchNative", "matchLearning"].forEach(id => {
  el(id).addEventListener("change", async () => {
    profile = { ...profile, native: el("matchNative").value, learning: el("matchLearning").value };
    el("learningStat").textContent = profile.learning;
    await api("/api/profile", { method: "PUT", body: JSON.stringify(profile) });
    showToast(`Now practicing ${profile.learning}`);
  });
});

// Sidebar buttons
el("navHome").onclick = openMenu;
el("navDeck").onclick = () => showView("deckView");
el("navProfile").onclick = () => openProfile("");

el("profileForm").onsubmit = async event => {
  event.preventDefault();
  const newProfile = readProfileForm("prof");
  if (newProfile.native === newProfile.learning) {
    el("profileStatus").textContent = "Pick two different languages!";
    return;
  }
  await api("/api/profile", { method: "PUT", body: JSON.stringify(newProfile) }); // save to database
  profile = newProfile;
  openMenu();
};


// ---------- MATCHING ----------
el("quickMatchBtn").onclick = findPartner;
el("nextBtn").onclick = findPartner;    // leave this partner and find a new one
el("menuBtn").onclick = leaveChat;
el("cancelSearchBtn").onclick = leaveChat;

function findPartner() {
  hangUp(); // end the video link with the old partner (my camera/mic stay as they were)
  socket.emit("find_partner", { token });
  el("searchStatus").textContent =
    `Looking for someone who speaks ${profile.learning} and is learning ${profile.native}...`;
  showScreen("searchScreen");
}

// Leave the chat (or the search) and go back to the menu
function leaveChat() {
  socket.emit("leave");
  hangUp();
  stopMyMedia(); // switch off camera + mic
  nextIcebreakerAt = 0;
  openMenu();
}


// ---------- CHAT ----------
// The server found us a partner!
socket.on("matched", partner => {
  messages = [];
  nextIcebreakerAt = 0;
  partnerName = partner.name;
  el("partnerInfo").textContent = `${partner.name} · speaks ${partner.native} · learning ${partner.learning}`;
  el("partnerAvatar").textContent = partner.name[0].toUpperCase();
  showScreen("chatScreen");
  render();
  startCall(partner.initiator); // join the call automatically
});

// Our partner clicked Next or closed their tab
socket.on("partner_left", () => {
  addSystemMessage("Your partner left. Click Next to find someone new.");
  nextIcebreakerAt = 0; // no more questions in this chat
  hangUp();
  callState = "ended";
  updatePartnerUI();
});

// A new chat message (from me or my partner), with its translation
socket.on("chat_message", msg => {
  messages.push(msg);
  el("typing").textContent = ""; // they sent it, so they're done typing
  render();
});

function addSystemMessage(text) {
  messages.push({ from: "system", text });
  render();
}

// When I submit the form, send my text to the server
el("chatForm").onsubmit = event => {
  event.preventDefault(); // stop the page from reloading (forms do that by default)
  const input = el("chatInput");
  if (input.value.trim() === "") return; // ignore empty messages
  socket.emit("chat_message", input.value);
  input.value = ""; // clear the box
};

// TYPING INDICATOR: tell the server I'm typing (at most once per second)
let lastTypingSent = 0;
el("chatInput").oninput = () => {
  if (Date.now() - lastTypingSent > 1000) {
    socket.emit("typing");
    lastTypingSent = Date.now();
  }
};

// Show "Ana is typing..." and hide it again after 2 seconds of silence
let typingTimer;
socket.on("partner_typing", () => {
  el("typing").textContent = `${partnerName} is typing...`;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => (el("typing").textContent = ""), 2000);
});


// ---------- ICEBREAKERS ----------
let nextIcebreakerAt = 0; // when the next question arrives (a Date.now() time), 0 = none coming

// The server sent a new question. It goes into the chat like a special message.
socket.on("icebreaker", icebreaker => {
  messages.push({
    from: "icebreaker",
    text: icebreaker.question,
    translation: icebreaker.translation,
    language: icebreaker.language,
    answered: [], // connection ids of people who answered
  });
  nextIcebreakerAt = Date.now() + icebreaker.next_in * 1000;
  render();
});

// Someone answered: update the ✅ / ⏳ on the newest question card
socket.on("icebreaker_answered", answered => {
  const card = messages.findLast(msg => msg.from === "icebreaker");
  if (card) card.answered = answered;
  render();
});

// Every second, update the countdown, e.g. "Next question in 1:05"
setInterval(() => {
  const seconds = Math.max(0, Math.round((nextIcebreakerAt - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0"); // 5 -> "05"
  el("icebreakerTimer").textContent = nextIcebreakerAt ? `🧊 Next question in ${minutes}:${rest}` : "";
}, 1000);


// ---------- VIDEO CALL (WebRTC) ----------
// You join the call automatically when matched, with camera and mic OFF.
// The video and audio go DIRECTLY between the two browsers. Our server only
// passes small "call" messages so the browsers can find each other ("signaling").
let peer = null;      // RTCPeerConnection: the direct browser-to-browser link
let micTrack = null;  // my microphone (null = off)
let camTrack = null;  // my camera (null = off)
let callState = "connecting";                 // connecting | connected | failed | ended
let partnerMedia = { mic: false, cam: false }; // is my partner's mic / camera on?

// A free public "STUN" server tells each browser its address on the internet
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function sendCall(data) {
  socket.emit("call", data);
}

function startCall(initiator) {
  hangUp();
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer = connection;
  callState = "connecting";
  updatePartnerUI();

  // My partner's audio/video arrives here
  const remoteStream = new MediaStream();
  el("remoteVideo").srcObject = remoteStream;
  connection.ontrack = event => {
    remoteStream.addTrack(event.track);
    el("remoteVideo").play().catch(() => {});
  };
  // My browser found a possible route to me: tell my partner about it
  connection.onicecandidate = event => {
    if (event.candidate) sendCall({ type: "candidate", candidate: event.candidate });
  };
  connection.onconnectionstatechange = () => {
    if (connection !== peer) return; // an old call, ignore it
    if (connection.connectionState === "connected") callState = "connected";
    if (connection.connectionState === "failed") callState = "failed";
    updatePartnerUI();
  };

  if (initiator) {
    // Reserve one audio + one video "slot" now. They stay empty until the mic or
    // camera is turned on, so switching them on later needs no new connection.
    connection.addTransceiver("audio", { direction: "sendrecv" });
    connection.addTransceiver("video", { direction: "sendrecv" });
    attachMyMedia();
    connection.createOffer()
      .then(offer => connection.setLocalDescription(offer))
      .then(() => {
        sendCall({ type: "offer", description: connection.localDescription });
        sendMediaState();
      });
  }
}

// Messages from my partner's browser, passed along by the server
async function handleCall(data) {
  if (data.type === "media") {
    partnerMedia = { mic: data.mic, cam: data.cam };
    updatePartnerUI();
  }
  if (!peer) return;
  if (data.type === "offer") {
    await peer.setRemoteDescription(data.description);
    peer.getTransceivers().forEach(transceiver => (transceiver.direction = "sendrecv"));
    attachMyMedia();
    await peer.setLocalDescription(await peer.createAnswer());
    sendCall({ type: "answer", description: peer.localDescription });
    sendMediaState();
  } else if (data.type === "answer") {
    await peer.setRemoteDescription(data.description);
  } else if (data.type === "candidate") {
    await peer.addIceCandidate(data.candidate);
  }
}

// Handle call messages ONE AT A TIME, in the order they arrived
// (e.g. a "candidate" must never be handled before the "offer" it belongs to)
let callQueue = Promise.resolve();
socket.on("call", data => {
  callQueue = callQueue.then(() => handleCall(data)).catch(error => console.error("Call error:", error));
});

// End the link with my partner (my own camera/mic are NOT switched off here)
function hangUp() {
  if (peer) peer.close();
  peer = null;
  el("remoteVideo").srcObject = null;
  partnerMedia = { mic: false, cam: false };
}

// The audio or video "slot" in the connection
function senderFor(kind) {
  if (!peer) return null;
  const transceiver = peer.getTransceivers().find(t => t.receiver.track.kind === kind);
  return transceiver ? transceiver.sender : null;
}

// Put my current mic/camera (or nothing) into the connection
function attachMyMedia() {
  senderFor("audio")?.replaceTrack(micTrack).catch(() => {});
  senderFor("video")?.replaceTrack(camTrack).catch(() => {});
}

// Tell my partner whether my mic / camera is on
function sendMediaState() {
  sendCall({ type: "media", mic: !!micTrack, cam: !!camTrack });
}

el("micBtn").onclick = async () => {
  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  } else {
    try {
      micTrack = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
    } catch {
      addSystemMessage("Couldn't use your microphone. Check your browser permissions.");
      return;
    }
  }
  attachMyMedia();
  updateMyButtons();
  sendMediaState();
};

el("camBtn").onclick = async () => {
  if (camTrack) {
    camTrack.stop(); // this also turns off the camera light
    camTrack = null;
  } else {
    try {
      camTrack = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
    } catch {
      addSystemMessage("Couldn't use your camera. Check your browser permissions.");
      return;
    }
  }
  attachMyMedia();
  updateMyButtons();
  sendMediaState();
};

function stopMyMedia() {
  if (micTrack) micTrack.stop();
  if (camTrack) camTrack.stop();
  micTrack = camTrack = null;
  updateMyButtons();
}

// Red buttons = off. Show my own camera in the corner when it's on.
function updateMyButtons() {
  el("micBtn").classList.toggle("off", !micTrack);
  el("camBtn").classList.toggle("off", !camTrack);
  el("localVideo").srcObject = camTrack ? new MediaStream([camTrack]) : null;
  el("localVideo").hidden = !camTrack;
}

// Show my partner's video, or their avatar + a status line when their camera is off
function updatePartnerUI() {
  el("partnerPlaceholder").hidden = callState === "connected" && partnerMedia.cam;
  const mic = partnerMedia.mic ? "🎤 Mic on" : "🔇 Mic off";
  el("callStatus").textContent = {
    connecting: "Connecting...",
    connected: `Camera off · ${mic}`,
    failed: "Couldn't connect the call. Text chat still works.",
    ended: "Your partner left.",
  }[callState];
}


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
async function saveWord(word, sentence, translation, language) {
  if (!word) return;
  const card = await api("/api/flashcards", {
    method: "POST",
    body: JSON.stringify({
      word,
      sentence,
      translation,
      language,
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

el("newDeckForm").onsubmit = async event => {
  event.preventDefault();
  await api("/api/decks", { method: "POST", body: JSON.stringify({ name: el("newDeckName").value }) });
  el("newDeckName").value = "";
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
    return text.split(/(\s+)/).map(part => ({ segment: part, isWordLike: /\S/.test(part) }));
  }
  return [...new Intl.Segmenter(LOCALES[language], { granularity: "word" }).segment(text)];
}

// Turn "Hola!" into "hola" so punctuation doesn't matter
function clean(word) {
  return word.toLowerCase().replace(/[^\p{L}]/gu, "");
}


// ---------- WORD POPUP ----------
// Hover over a word (or tap it on a phone) to see a short translation,
// the language it's in, and buttons to save it or report a bad translation.
let popupWord = null;   // the word the popup is showing: { word, sentence, language, translation }
let showTimer, hideTimer;
const wordCache = {};   // remembers translations, so hovering the same word twice is instant

function attachWordPopup(span, word, sentence, language) {
  if (!word) return; // e.g. a lonely "?" or emoji
  span.onmouseenter = () => {
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => openWordPopup(span, word, sentence, language), 300); // small delay
  };
  span.onmouseleave = () => {
    clearTimeout(showTimer);
    hidePopupSoon();
  };
  span.onclick = () => openWordPopup(span, word, sentence, language); // phones have no hover
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

async function openWordPopup(span, word, sentence, language) {
  clearTimeout(hideTimer);
  const saved = deck[word];
  popupWord = { word, sentence, language, translation: saved ? saved.translation : null };

  el("popupWord").textContent = word;
  el("popupLang").textContent = language || "";
  el("popupTranslation").textContent = saved ? saved.translation || "(no translation)" : "Translating...";
  el("popupAddBtn").textContent = saved ? "✓ In your deck" : "+ Add to deck";
  el("popupAddBtn").disabled = !!saved;
  placePopup(span);
  if (saved) return; // we already know its translation

  // Ask the server (once per word + sentence)
  const key = word + "|" + sentence;
  wordCache[key] ??= api("/api/translate-word", {
    method: "POST",
    body: JSON.stringify({ word, sentence, language }),
  });
  const result = await wordCache[key];
  if (!popupWord || popupWord.word !== word) return; // the mouse already moved to another word
  popupWord.translation = result.translation;
  el("popupTranslation").textContent = result.translation || "(no translation found)";
  el("popupLang").textContent = result.language || "";
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
  const { word, sentence, translation, language } = popupWord;
  el("popupAddBtn").disabled = true;
  await saveWord(word, sentence, translation, language);
  el("popupAddBtn").textContent = "✓ In your deck";
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


// ---------- STUDY MODE ----------
let studyDeck = null;  // the deck being studied
let studyCards = [];   // its cards, in random order
let studyIndex = 0;    // which card we're on
let knownCount = 0;

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
  el("studyTranslation").textContent = card.translation || "(no translation yet)";
  el("studyExample").textContent = card.example ? `"${card.example}"` : "";
  el("studyAnswer").hidden = true;
}

el("showAnswerBtn").onclick = () => {
  el("studyAnswer").hidden = false;
  el("showAnswerBtn").hidden = true;
  el("stillLearningBtn").hidden = el("knowItBtn").hidden = false;
  el("studyReportBtn").hidden = false;
};

// Save how well I know the card, then go to the next one
async function answerCard(status) {
  const card = studyCards[studyIndex];
  if (status === "known") knownCount++;
  card.status = status;
  studyIndex++;
  showStudyCard();
  await api("/api/flashcards/" + encodeURIComponent(card.word), {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

el("knowItBtn").onclick = () => answerCard("known");
el("stillLearningBtn").onclick = () => answerCard("learning");
el("studyAgainBtn").onclick = () => startStudy(studyDeck);
el("studyBackBtn").onclick = () => showView("deckView");
el("studyReportBtn").onclick = () => {
  const card = studyCards[studyIndex];
  openReport(card.word, card.translation, card.example);
};


// ---------- DRAWING ----------
// Add a small line of text with a CSS class inside a message, e.g. a translation
function addLine(parent, className, text) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  parent.appendChild(line);
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
      addLine(div, "icebreaker-label", "🧊 Icebreaker");
    } else {
      // socket.id is MY connection id. If it matches, I sent this message.
      div.className = "message" + (msg.from === socket.id ? " me" : "");
    }
    splitWords(msg.text, msg.language).forEach(part => {
      const span = document.createElement("span");
      span.textContent = part.segment;
      if (part.isWordLike) { // a real word (not a space or punctuation)
        span.className = "word";
        const key = clean(part.segment);
        if (deck[key]) span.style.color = deck[key].color; // ⭐ the highlight!
        attachWordPopup(span, key, msg.text, msg.language); // hover or tap: see what it means
      }
      div.appendChild(span);
    });
    // The automatic translation, like a subtitle
    if (msg.translation) addLine(div, "translation", msg.translation);
    // Who has answered the question so far
    if (msg.from === "icebreaker") {
      const meDone = msg.answered.includes(socket.id) ? "✅" : "⏳";
      const partnerDone = msg.answered.some(id => id !== socket.id) ? "✅" : "⏳";
      addLine(div, "icebreaker-status", `You ${meDone} · ${partnerName} ${partnerDone}`);
    }
    // This message was someone's answer to an icebreaker
    if (msg.answer) addLine(div, "answer-badge", "💬 Answer");
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight; // auto-scroll to the newest message

  el("deckCount").textContent = Object.keys(deck).length;

  renderDecks();
}

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
    title.textContent = d.name + " ";
    const count = document.createElement("span");
    count.textContent = `${cards.length} cards`;
    title.appendChild(count);
    const study = document.createElement("button");
    study.className = "primary small";
    study.textContent = "▶ Study";
    study.disabled = cards.length === 0;
    study.onclick = () => startStudy(d);
    const del = document.createElement("button");
    del.className = "danger-text";
    del.textContent = "Delete deck";
    del.onclick = () => deleteDeck(d);
    const buttons = document.createElement("div");
    buttons.className = "deck-head-buttons";
    buttons.append(study, del);
    head.append(title, buttons);

    const list = document.createElement("ul");
    list.className = "deck-list";
    if (cards.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No words yet. Click words in a chat to save them here!";
      list.appendChild(li);
    }
    cards.forEach(card => {
      const li = document.createElement("li");
      const word = document.createElement("span");
      word.className = "swatch";
      word.style.background = card.color;
      // ✅ = I know it, 😅 = still learning (from study mode)
      const icon = { known: " ✅", learning: " 😅" }[card.status] || "";
      word.textContent = card.word + icon;
      const translation = document.createElement("span");
      translation.className = "card-translation" + (card.translation ? "" : " missing");
      translation.textContent = card.translation || "add translation";
      translation.onclick = () => editTranslation(card.word);
      const remove = document.createElement("button");
      remove.textContent = "✕";
      remove.title = "Delete card";
      remove.onclick = () => deleteWord(card.word);
      li.append(word, translation, remove);
      list.appendChild(li);
    });

    box.append(head, list);
    groups.appendChild(box);
  });
}

start(); // run when the page opens
