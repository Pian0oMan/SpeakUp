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
      showScreen("landingScreen"); // visitors start on the landing page
    }
  });
}

// LANDING PAGE buttons (there are several of each, so we use classes instead of ids)
document.querySelectorAll(".to-login").forEach(button => (button.onclick = () => showScreen("loginScreen")));
document.querySelectorAll(".to-register").forEach(button => (button.onclick = () => showScreen("registerScreen")));
document.querySelectorAll(".to-landing").forEach(link => {
  link.onclick = event => {
    event.preventDefault();
    showScreen("landingScreen");
  };
});
el("howItWorksBtn").onclick = () => el("howItWorks").scrollIntoView({ behavior: "smooth" });

// The scrolling belt of "hello" in many languages.
// It holds the list TWICE in a row and slides left by exactly one list, then starts
// over: because the second copy is identical, the jump back is invisible. One copy
// must be wider than the screen, or there's an empty gap: that's why the list is long.
const GREETINGS = [
  "Hello", "こんにちは", "Hola", "Bonjour", "Hallo", "你好", "Привет", "Ciao", "Olá", "안녕하세요",
  "Merhaba", "Hej", "नमस्ते", "مرحبا", "שלום", "Γειά σου", "Xin chào", "สวัสดี", "Halo", "Jambo",
  "Cześć", "Ahoj", "Szia", "Kia ora", "Aloha", "Sawubona", "Hei", "Dia dhuit", "Salut", "Mabuhay",
];
[...GREETINGS, ...GREETINGS].forEach(word => {
  const span = document.createElement("span");
  span.textContent = word;
  el("marqueeTrack").appendChild(span);
});

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
  if (currentRoom) leaveRoom();
  leaveChat();
  sb.auth.signOut();
};


// ---------- MAIN MENU, PROFILE, DECK ----------
async function enterApp() {
  loggedIn = true;
  profile = await api("/api/profile");
  await loadDeck();
  sayHello();     // so my friends see me online
  loadSocial();   // friends + recent people
  loadProgress(); // level, XP, streak
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
  el("greeting").textContent = `Hi, ${profile.username}`;
  el("matchNative").value = profile.native;
  el("matchLearning").value = profile.learning;
  blockSameLanguage(["matchNative", "matchLearning"]);
  socket.emit("list_rooms"); // for "3 people talking in Japanese" on the voice room card
  updateRoomsLive();
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
    updateRoomsLive(); // the voice room card follows the language I'm practicing
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
  partnerUserId = partner.user_id;
  updateAddPartnerButton(); // "+ Add friend" (or "Friends" if we already are)
  el("partnerInfo").replaceChildren(partner.name + " ", languageTag(partner.native, partner.learning));
  el("partnerAvatar").textContent = partner.name[0].toUpperCase();
  // "Speaking" choices for live captions: the language I'm learning (default) or my own
  const speakLang = el("speakLang");
  const current = speakLang.value;
  speakLang.innerHTML = "";
  [profile.learning, profile.native].forEach(lang => speakLang.add(new Option(lang, lang)));
  if (current === profile.native) speakLang.value = current; // keep my choice between matches
  showCaption(el("partnerCaption"), "", null);
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

// Someone answered: update who-has-answered on the newest question card
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
  el("icebreakerTimer").textContent = nextIcebreakerAt ? `Next question in ${minutes}:${rest}` : "";
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

// The mic button works the same in a 1-on-1 call and in a voice room
async function toggleMic() {
  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  } else {
    try {
      micTrack = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
    } catch {
      notice("Couldn't use your microphone. Check your browser permissions.");
      return;
    }
  }
  if (micTrack) startCaptions(); // mic on = live captions on
  else stopCaptions();
  attachMyMedia();                               // 1-on-1 call
  Object.values(roomPeers).forEach(attachRoomMic); // everyone in my voice room
  updateMyButtons();
  if (currentRoom) {
    socket.emit("room_media", { mic: !!micTrack });
    renderMembers();
  } else {
    sendMediaState();
  }
}
el("micBtn").onclick = toggleMic;
el("roomMicBtn").onclick = toggleMic;

// A grey notice in whichever chat I'm in (the 1-on-1 chat or the room's side chat)
function notice(text) {
  if (currentRoom) roomNotice(text);
  else addSystemMessage(text);
}

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
  stopCaptions();
  if (micTrack) micTrack.stop();
  if (camTrack) camTrack.stop();
  micTrack = camTrack = null;
  updateMyButtons();
}

// Red buttons = off. Show my own camera in the corner when it's on.
function updateMyButtons() {
  el("micBtn").classList.toggle("off", !micTrack);
  el("roomMicBtn").classList.toggle("off", !micTrack);
  el("camBtn").classList.toggle("off", !camTrack);
  // Crossed-out icons when they're off
  el("micBtn").innerHTML = el("roomMicBtn").innerHTML = icon(micTrack ? "mic" : "micOff");
  el("camBtn").innerHTML = icon(camTrack ? "camera" : "cameraOff");
  el("localVideo").srcObject = camTrack ? new MediaStream([camTrack]) : null;
  el("localVideo").hidden = !camTrack;
}

// Show my partner's video, or their avatar + a status line when their camera is off
function updatePartnerUI() {
  el("partnerPlaceholder").hidden = callState === "connected" && partnerMedia.cam;
  const mic = partnerMedia.mic ? "Mic on" : "Muted";
  el("callStatus").textContent = {
    connecting: "Connecting...",
    connected: `Camera off · ${mic}`,
    failed: "Couldn't connect the call. Text chat still works.",
    ended: "Your partner left.",
  }[callState];
}


// ---------- LIVE CAPTIONS (speech to text) ----------
// The browser's built-in speech recognition turns what I say into text.
// (Chrome and Edge have it. In Chrome, the audio is processed by Google.)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LOCALES = {
  English: "en-US", Spanish: "es-ES", French: "fr-FR", German: "de-DE",
  Japanese: "ja-JP", Chinese: "zh-CN", Russian: "ru-RU",
};
let recognizer = null;       // the speech recognizer while it's running
let captionsWanted = false;  // should captions be running? (= my mic is on)
let lastCaptionSent = 0;
let warnedNoCaptions = false;

function startCaptions() {
  if (!SpeechRecognition) {
    if (!warnedNoCaptions) notice("Live captions work in Chrome and Edge.");
    warnedNoCaptions = true;
    return;
  }
  captionsWanted = true;
  if (recognizer) return; // already running

  // Which "Speaking" picker counts: the room's one, or the 1-on-1 call's one
  const language = el(currentRoom ? "roomSpeakLang" : "speakLang").value;
  recognizer = new SpeechRecognition();
  recognizer.lang = SPEECH_LOCALES[language];
  recognizer.continuous = true;      // keep listening, don't stop after one sentence
  recognizer.interimResults = true;  // give me words WHILE I'm still talking

  recognizer.onresult = event => {
    let unfinished = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim();
      if (!text) continue;
      if (event.results[i].isFinal) {
        // A finished sentence: my partner sees it, and it goes into the chat
        socket.emit("caption", { text, final: true, language });
      } else {
        unfinished += text + " ";
      }
    }
    unfinished = unfinished.trim();
    // Words so far (sent at most ~3 times a second, so we don't flood the server)
    if (unfinished && Date.now() - lastCaptionSent > 300) {
      lastCaptionSent = Date.now();
      socket.emit("caption", { text: unfinished, final: false, language });
    }
    showMyCaption(unfinished, language); // so I can see it's working
  };

  // Chrome stops listening after a few seconds of silence: just start again
  recognizer.onend = () => {
    recognizer = null;
    showMyCaption("", language);
    if (captionsWanted) setTimeout(startCaptions, 300);
  };
  recognizer.onerror = event => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      captionsWanted = false;
      notice("Live captions need microphone permission.");
    }
  };
  recognizer.start();
}

function stopCaptions() {
  captionsWanted = false;
  if (recognizer) recognizer.stop();
}

// Switching the "Speaking" language: restart the recognizer with the new language
el("speakLang").onchange = el("roomSpeakLang").onchange = () => {
  if (recognizer) recognizer.stop(); // onend starts it again, with the new language
};

// Show a caption, word by word, so words can be hovered for a translation
function showCaption(box, text, language) {
  if (!box) return;
  box.innerHTML = "";
  box.hidden = !text;
  if (text) appendWords(box, text, language);
}

// What I'm saying: over the video in a 1-on-1 call, or on my own tile in a room
function showMyCaption(text, language) {
  showCaption(el(currentRoom ? "myRoomCaption" : "myCaption"), text, language);
}

// My partner is talking: show their words, then hide them after 4 seconds of quiet
let captionTimer;
socket.on("caption", caption => {
  showCaption(el("partnerCaption"), caption.text, caption.language);
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => showCaption(el("partnerCaption"), "", null), 4000);
});


// ---------- VOICE ROOMS ----------
let roomList = [];      // all open rooms, sent by the server whenever something changes
let currentRoom = null; // the room I'm in (null = not in a room)
let roomMembers = {};   // everyone ELSE in my room: sid -> { name, native, learning, mic, caption }
let roomMessages = [];  // the side chat
let roomPeers = {};     // sid -> RTCPeerConnection: one direct audio link to each person

// "Max people" dropdown: 3 to 10
for (let n = 3; n <= 10; n++) el("roomMax").add(new Option(n, n));
el("roomMax").value = "6";

function openRooms() {
  socket.emit("list_rooms");
  renderRoomList();
  showView("roomsView");
}
el("navRooms").onclick = openRooms;

// "+ Create room" opens a pop-up window
el("openCreateRoomBtn").onclick = () => {
  el("roomName").value = "";
  el("roomLanguage").value = profile.learning;
  el("roomStatus").textContent = "";
  el("createRoomDialog").showModal();
};

// FILTERS: fill the language list, and redraw the rooms whenever a filter changes
LANGUAGES.forEach(lang => el("roomFilterLanguage").add(new Option(lang, lang)));
["roomSearch", "roomFilterLanguage", "roomFilterSize", "roomFilterFriends", "roomFilterHideFull"]
  .forEach(id => el(id).addEventListener("input", renderRoomList));

// Does a room pass all the filters?
function roomMatchesFilters(room) {
  const search = el("roomSearch").value.trim().toLowerCase();
  const language = el("roomFilterLanguage").value;
  const size = el("roomFilterSize").value;
  const friendIds = new Set(social.friends.map(friend => friend.user_id));

  if (search && !room.name.toLowerCase().includes(search)) return false;
  if (language && room.language !== language) return false;
  if (size === "small" && room.max_size > 4) return false;
  if (size === "medium" && (room.max_size < 5 || room.max_size > 7)) return false;
  if (size === "large" && room.max_size < 8) return false;
  if (el("roomFilterFriends").checked && !room.member_ids.some(id => friendIds.has(id))) return false;
  if (el("roomFilterHideFull").checked && room.count >= room.max_size) return false;
  return true;
}

// RANDOM VOICE ROOM (home page): the server picks an open room in my language,
// preferring rooms where people are already talking
el("randomRoomBtn").onclick = () => {
  socket.emit("join_random_room", { token, language: profile.learning });
};

// "3 people talking in Japanese right now" on the home page card
function updateRoomsLive() {
  if (!profile) return;
  const mine = roomList.filter(room => room.language === profile.learning);
  const people = mine.reduce((sum, room) => sum + room.count, 0);
  el("randomRoomText").textContent = `Jump into a group conversation in ${profile.learning} right now.`;
  el("roomsLive").textContent = people > 0
    ? `${people} ${people === 1 ? "person" : "people"} talking in ${profile.learning} now`
    : mine.length > 0
      ? `${mine.length} ${profile.learning} ${mine.length === 1 ? "room" : "rooms"} open, be the first to talk`
      : `No ${profile.learning} rooms yet`;
}

socket.on("rooms", list => {
  roomList = list;
  updateRoomsLive();
  renderRoomList();
  if (currentRoom) {
    const mine = list.find(room => room.id === currentRoom.id);
    if (mine) currentRoom = mine; // keeps the "4 / 10" count up to date
  }
});

function renderRoomList() {
  const box = el("roomList");
  box.innerHTML = "";
  const shown = roomList.filter(roomMatchesFilters);
  if (shown.length === 0) {
    box.innerHTML = roomList.length
      ? '<p class="empty-note">No rooms match your filters.</p>'
      : '<p class="empty-note">No rooms open right now. Create one!</p>';
  }
  shown.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";
    const name = document.createElement("h3");
    name.textContent = room.name;
    const meta = document.createElement("div");
    meta.className = "room-meta";
    meta.replaceChildren(languageTag(room.language), ` hosted by ${room.host}`);
    const bottom = document.createElement("div");
    bottom.className = "room-bottom";
    const people = document.createElement("span");
    people.className = "room-people";
    people.textContent = `${room.count} / ${room.max_size} people`;
    const join = document.createElement("button");
    join.className = "primary small";
    const full = room.count >= room.max_size;
    join.textContent = full ? "Full" : "Join";
    join.disabled = full;
    join.onclick = () => socket.emit("join_room", { token, room_id: room.id });
    bottom.append(people, join);
    card.append(name, meta, bottom);
    box.appendChild(card);
  });
}

el("createRoomForm").onsubmit = event => {
  event.preventDefault();
  socket.emit("create_room", {
    token,
    name: el("roomName").value,
    language: el("roomLanguage").value,
    max_size: Number(el("roomMax").value),
  });
  el("roomName").value = "";
};

socket.on("room_error", message => {
  el("roomStatus").textContent = message;
  showToast(message);
});

// I'm in! The server sends the room, who's already there, and the recent side chat.
socket.on("room_joined", data => {
  if (el("createRoomDialog").open) el("createRoomDialog").close(); // I made this room
  closeRoomPeers();
  hangUp(); // just in case I was in a 1-on-1 call
  currentRoom = data.room;
  roomMembers = {};
  data.members.forEach(member => (roomMembers[member.sid] = { ...member, mic: false, caption: "" }));
  roomMessages = data.history;

  // "Speaking" choices for captions: the room's language, plus my two languages
  const speak = el("roomSpeakLang");
  speak.innerHTML = "";
  [...new Set([currentRoom.language, profile.learning, profile.native])]
    .forEach(lang => speak.add(new Option(lang, lang)));

  el("roomInfo").textContent = `${currentRoom.name} · ${currentRoom.language}`;
  showScreen("roomScreen");
  renderMembers();
  renderRoomMessages();

  // I'm the new one, so I start an audio link with everyone already in the room
  // (they answer). This way two people never start a link to each other at once.
  data.members.forEach(member => connectToMember(member.sid, true));
});

socket.on("room_member_joined", member => {
  roomMembers[member.sid] = { ...member, mic: false, caption: "" };
  roomNotice(`${member.name} joined`);
  renderMembers();
  // They will start the audio link with me
});

socket.on("room_member_left", sid => {
  const member = roomMembers[sid];
  if (roomPeers[sid]) {
    roomPeers[sid].close();
    roomPeers[sid].audio.srcObject = null;
    delete roomPeers[sid];
  }
  delete roomMembers[sid];
  if (member) roomNotice(`${member.name} left`);
  renderMembers();
});

socket.on("room_media", ({ sid, mic }) => {
  if (roomMembers[sid]) roomMembers[sid].mic = mic;
  renderMembers();
});

// Someone in the room is talking: show their words on their tile for a few seconds
const roomCaptionTimers = {};
socket.on("room_caption", ({ sid, text, language }) => {
  showCaption(el("caption-" + sid), text, language);
  clearTimeout(roomCaptionTimers[sid]);
  roomCaptionTimers[sid] = setTimeout(() => showCaption(el("caption-" + sid), "", null), 4000);
});

function leaveRoom() {
  socket.emit("leave_room");
  closeRoomPeers();
  stopMyMedia(); // mic off
  currentRoom = null;
  roomMembers = {};
  openRooms();
}
el("leaveRoomBtn").onclick = leaveRoom;

// --- Room audio: one direct WebRTC link to each person ("mesh") ---
function connectToMember(sid, initiator) {
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  roomPeers[sid] = connection;

  // Their voice plays through an invisible <audio> element
  const stream = new MediaStream();
  connection.audio = new Audio();
  connection.audio.autoplay = true;
  connection.audio.srcObject = stream;
  connection.ontrack = event => {
    stream.addTrack(event.track);
    connection.audio.play().catch(() => {});
  };
  connection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("room_signal", { to: sid, data: { type: "candidate", candidate: event.candidate } });
    }
  };

  if (initiator) {
    connection.addTransceiver("audio", { direction: "sendrecv" }); // one audio "slot", like 1-on-1 calls
    attachRoomMic(connection);
    connection.createOffer()
      .then(offer => connection.setLocalDescription(offer))
      .then(() => socket.emit("room_signal", {
        to: sid, data: { type: "offer", description: connection.localDescription },
      }));
  }
  return connection;
}

// Put my microphone (or silence, if it's off) into a link
function attachRoomMic(connection) {
  const transceiver = connection.getTransceivers().find(t => t.receiver.track.kind === "audio");
  if (transceiver) transceiver.sender.replaceTrack(micTrack).catch(() => {});
}

async function handleRoomSignal({ from, data }) {
  let connection = roomPeers[from];
  if (data.type === "offer") {
    if (!connection) connection = connectToMember(from, false);
    await connection.setRemoteDescription(data.description);
    connection.getTransceivers().forEach(t => (t.direction = "sendrecv"));
    attachRoomMic(connection);
    await connection.setLocalDescription(await connection.createAnswer());
    socket.emit("room_signal", { to: from, data: { type: "answer", description: connection.localDescription } });
  } else if (!connection) {
    return; // a message for a link that's already closed
  } else if (data.type === "answer") {
    await connection.setRemoteDescription(data.description);
  } else if (data.type === "candidate") {
    await connection.addIceCandidate(data.candidate);
  }
}

// One at a time, in order (same reason as in 1-on-1 calls)
let roomSignalQueue = Promise.resolve();
socket.on("room_signal", message => {
  roomSignalQueue = roomSignalQueue.then(() => handleRoomSignal(message))
    .catch(error => console.error("Room audio error:", error));
});

function closeRoomPeers() {
  Object.values(roomPeers).forEach(connection => {
    connection.close();
    connection.audio.srcObject = null;
  });
  roomPeers = {};
}

// --- Drawing the room ---
function renderMembers() {
  if (!currentRoom) return;
  const box = el("roomMembers");
  box.innerHTML = "";
  const me = { sid: socket.id, name: `${profile.username} (you)`, native: profile.native,
               learning: profile.learning, mic: !!micTrack, me: true };
  const everyone = [me, ...Object.values(roomMembers)];
  everyone.forEach(member => {
    const tile = document.createElement("div");
    tile.className = "member-tile" + (member.mic ? " talking" : "");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = member.name[0].toUpperCase();
    const name = document.createElement("strong");
    name.textContent = member.name;
    const langs = languageTag(member.native, member.learning); // e.g. "EN → JA"
    const mic = document.createElement("span");
    mic.className = "mic-state";
    mic.textContent = member.mic ? "Mic on" : "Muted";
    const caption = document.createElement("div"); // live captions while they talk
    caption.className = "member-caption";
    caption.id = member.me ? "myRoomCaption" : "caption-" + member.sid;
    caption.hidden = true;
    tile.append(avatar, name, langs, mic, caption);
    if (!member.me && member.user_id) tile.appendChild(makeFriendButton(member.user_id, member.name));
    box.appendChild(tile);
  });
  el("roomCount").textContent = `${everyone.length} / ${currentRoom.max_size}`;
  sizeTiles(box, everyone.length);
}

// The people fill the space: few people = big tiles, more people = smaller tiles.
// (Like Discord or Zoom.) CSS reads these two numbers: --cols and --avatar.
const TILE_LAYOUT = {
  1: [1, 180], 2: [2, 150], 3: [2, 120], 4: [2, 120], 5: [3, 100],
  6: [3, 100], 7: [3, 84], 8: [3, 84], 9: [3, 84], 10: [4, 72],
};
function sizeTiles(box, count) {
  const [columns, avatar] = TILE_LAYOUT[Math.min(count, 10)] || TILE_LAYOUT[1];
  box.style.setProperty("--cols", columns);
  box.style.setProperty("--avatar", avatar + "px");
}

// --- The side chat ---
socket.on("room_message", msg => {
  roomMessages.push(msg);
  renderRoomMessages();
});

function roomNotice(text) {
  roomMessages.push({ system: true, text });
  renderRoomMessages();
}

el("roomChatForm").onsubmit = event => {
  event.preventDefault();
  const input = el("roomChatInput");
  if (input.value.trim() === "") return;
  socket.emit("room_message", input.value);
  input.value = "";
};

function renderRoomMessages() {
  const box = el("roomMessages");
  box.innerHTML = "";
  roomMessages.forEach(msg => {
    const div = document.createElement("div");
    if (msg.system) {
      div.className = "message system";
      div.textContent = msg.text;
    } else {
      const mine = msg.from === socket.id;
      div.className = "message" + (mine ? " me" : "");
      if (!mine) addLine(div, "sender-name", msg.name); // group chat: show who wrote it
      if (msg.voice) addLine(div, "voice-label", "Spoken");
      appendWords(div, msg.text, msg.language); // hover popup + deck highlights work here too
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}


// ---------- PRONUNCIATION ----------
// The browser can read text out loud ("speech synthesis"), free, built into Chrome,
// Edge, Safari and Firefox. It uses voices installed on the computer or phone.
const SPEAKER_ICON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
document.querySelectorAll(".speak-btn").forEach(button => (button.innerHTML = SPEAKER_ICON));

function makeSpeakButton(text, language) {
  const button = document.createElement("button");
  button.className = "speak-btn";
  button.title = "Listen";
  button.innerHTML = SPEAKER_ICON;
  button.onclick = event => {
    event.stopPropagation(); // don't also trigger whatever is under the button
    speak(text, language);
  };
  return button;
}

// If we don't know the language, guess from the writing system (or use what I'm learning)
function guessLanguage(text) {
  if (/[぀-ヿ]/.test(text)) return "Japanese";
  if (/[Ѐ-ӿ]/.test(text)) return "Russian";
  if (/[一-鿿]/.test(text)) return profile.learning === "Chinese" ? "Chinese" : "Japanese";
  return profile.learning;
}

function speak(text, language) {
  if (!text) return;
  if (!window.speechSynthesis) {
    showToast("Your browser can't read words out loud.");
    return;
  }
  const lang = SPEECH_LOCALES[language || guessLanguage(text)];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  // Pick a voice for that language if the computer has one
  const voice = speechSynthesis.getVoices().find(v => v.lang.replace("_", "-").startsWith(lang.slice(0, 2)));
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9; // a little slower than normal, easier for learners
  speechSynthesis.cancel(); // stop anything that's still playing
  speechSynthesis.speak(utterance);
}

el("popupSpeakWord").onclick = () => speak(popupWord.word, popupWord.language);
el("popupSpeakPhrase").onclick = () => speak(popupWord.phrase, popupWord.language);
el("studySpeakWord").onclick = () => {
  const card = studyCards[studyIndex];
  speak(card.word, card.language);
};
el("studySpeakExample").onclick = () => {
  const card = studyCards[studyIndex];
  speak(card.example, card.language);
};


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


// ---------- XP, LEVELS, STREAKS ----------
async function loadProgress() {
  try {
    showProgress(await api("/api/progress"));
  } catch {
    // e.g. the progress SQL hasn't been run yet
  }
}

// Draw the sidebar box and the home page "Today" card
function showProgress(p) {
  if (p.xp === undefined) return;
  const intoLevel = p.xp - p.level_start;
  const levelSize = p.level_end - p.level_start;
  el("levelBadge").textContent = `Lv ${p.level}`;
  el("streakCount").textContent = p.streak;
  el("streakBadge").classList.toggle("lit", p.streak > 0); // grey flame when there's no streak
  el("xpFill").style.width = `${(intoLevel / levelSize) * 100}%`;
  el("xpText").textContent = `${intoLevel} / ${levelSize} XP`;

  setRing(el("goalRing"), Math.min(100, (p.xp_today / p.daily_goal) * 100));
  el("goalText").textContent = `${p.xp_today} / ${p.daily_goal} XP`;
  el("todayStreak").textContent = `${p.streak} ${p.streak === 1 ? "day" : "days"} streak`;
  // The mascot's mood follows my streak: sleepy with no streak, happy while it's
  // alive, excited once I've reached today's goal
  const mood = p.xp_today >= p.daily_goal ? "excited" : p.streak > 0 ? "happy" : "sleepy";
  el("streakMascot").innerHTML = mascot(mood, 52);
  el("bestStreak").textContent = `Best: ${p.best_streak}`;
  el("todayLevel").textContent = `Level ${p.level}`;
  el("toNextLevel").textContent = `${p.level_end - p.xp} XP to level ${p.level + 1}`;
}

// LEVEL UP: the mascot jumps up in the middle of the screen for a few seconds
function celebrateLevelUp(level) {
  const overlay = document.createElement("div");
  overlay.className = "level-up";
  overlay.innerHTML = `
    <div class="level-up-box">
      ${mascot("excited", 120)}
      <h2>Level ${level}!</h2>
      <p>Keep talking, you're getting better every day.</p>
    </div>`;
  overlay.onclick = () => overlay.remove(); // click to close early
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3000);
}

// The server gave me XP (for a message, a saved word, a studied card...)
socket.on("xp", p => {
  showProgress(p);
  if (p.level_up) {
    celebrateLevelUp(p.level);
  } else if (p.reason !== "message" && p.reason !== "save_word") {
    // Messages happen a lot, and saving a word already shows "Saved ... → ...",
    // so those two only update the bar
    showToast(`+${p.gained} XP`);
  }
});


// ---------- FRIENDS + RECENT + ONLINE ----------
let social = { friends: [], incoming: [], outgoing: [], recent: [] };
let onlineIds = new Set(); // account ids of people who are online right now

// Tell the server who I am, so friends can see I'm online
function sayHello() {
  if (token) socket.emit("hello", { token, tz: new Date().getTimezoneOffset() });
}
socket.on("connect", () => {
  if (loggedIn) sayHello(); // e.g. the connection dropped and came back
});

async function loadSocial() {
  try {
    social = await api("/api/social");
  } catch {
    return; // e.g. the friends SQL hasn't been run yet
  }
  if (!social.friends) return;
  renderSocial();
  askWhoIsOnline();
}
socket.on("social_changed", loadSocial); // someone sent me a request, accepted mine, chatted...

// Every 20 seconds: who of my friends / recent people is online?
function askWhoIsOnline() {
  const ids = [...social.friends, ...social.recent].map(person => person.user_id);
  if (ids.length) socket.emit("who_is_online", ids);
}
setInterval(() => {
  if (loggedIn) askWhoIsOnline();
}, 20000);
socket.on("online", ids => {
  onlineIds = new Set(ids);
  renderSocial();
});

// What am I to this person? "friend", "requested" (I asked), "incoming" (they asked), or null
function relationTo(userId) {
  if (social.friends.some(p => p.user_id === userId)) return "friend";
  if (social.outgoing.some(p => p.user_id === userId)) return "requested";
  if (social.incoming.some(p => p.user_id === userId)) return "incoming";
  return null;
}

async function addFriend(userId, name) {
  await api("/api/friends", { method: "POST", body: JSON.stringify({ user_id: userId, name }) });
  showToast(relationTo(userId) === "incoming" ? `You and ${name} are now friends` : `Friend request sent to ${name}`);
  loadSocial();
}

async function acceptFriend(person) {
  await api(`/api/friends/${person.id}/accept`, { method: "POST" });
  showToast(`You and ${person.name} are now friends`);
  loadSocial();
}

async function removeFriendship(person, question) {
  if (question && !confirm(question)) return;
  await api(`/api/friends/${person.id}`, { method: "DELETE" });
  loadSocial();
}

// A button that fits my relation to someone: "+ Add friend", "Accept", "Requested", "Friends"
function makeFriendButton(userId, name) {
  const relation = relationTo(userId);
  const button = document.createElement("button");
  button.className = "ghost small";
  if (relation === "friend") {
    button.textContent = "Friends";
    button.disabled = true;
  } else if (relation === "requested") {
    button.textContent = "Requested";
    button.disabled = true;
  } else if (relation === "incoming") {
    button.textContent = "Accept";
    button.onclick = () => acceptFriend(social.incoming.find(p => p.user_id === userId));
  } else {
    button.textContent = "+ Add friend";
    button.onclick = () => addFriend(userId, name);
  }
  return button;
}

// One person in a list: avatar with online dot, name, a short line, and buttons
function makePersonRow(userId, name, subtitle, buttons) {
  const li = document.createElement("li");
  const avatar = document.createElement("div");
  avatar.className = "person-avatar";
  avatar.textContent = name[0].toUpperCase();
  const dot = document.createElement("span");
  dot.className = "online-dot" + (onlineIds.has(userId) ? " on" : "");
  dot.title = onlineIds.has(userId) ? "Online" : "Offline";
  avatar.appendChild(dot);
  const info = document.createElement("div");
  info.className = "person-info";
  const strong = document.createElement("strong");
  strong.textContent = name;
  const line = document.createElement("span");
  line.textContent = subtitle;
  info.append(strong, line);
  const buttonBox = document.createElement("div");
  buttonBox.className = "person-buttons";
  buttonBox.append(...buttons);
  li.append(avatar, info, buttonBox);
  return li;
}

function smallButton(text, onclick, className = "ghost small") {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = text;
  button.onclick = onclick;
  return button;
}

// e.g. "5 min ago", "yesterday"
function timeAgo(isoTime) {
  const minutes = Math.round((Date.now() - new Date(isoTime)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function fillList(list, people, makeRow, emptyText) {
  list.innerHTML = "";
  if (people.length === 0 && emptyText) list.innerHTML = `<li>${emptyState("sad", emptyText)}</li>`;
  people.forEach(person => list.appendChild(makeRow(person)));
}

function renderSocial() {
  const online = id => (onlineIds.has(id) ? "Online" : "Offline");

  // RECENT (right panel + the phone version on the Friends page)
  [el("recentList"), el("recentListMobile")].forEach(list => fillList(list, social.recent,
    person => makePersonRow(person.user_id, person.name,
      `${onlineIds.has(person.user_id) ? "Online · " : ""}${timeAgo(person.last_at)}`,
      [makeFriendButton(person.user_id, person.name)]),
    "People you chat with show up here."));

  // FRIENDS PAGE
  fillList(el("friendsList"), social.friends,
    person => makePersonRow(person.user_id, person.name, online(person.user_id),
      [smallButton("Remove", () => removeFriendship(person, `Remove ${person.name} from your friends?`))]),
    "No friends yet. Add people you meet from your Recent list.");
  fillList(el("incomingList"), social.incoming,
    person => makePersonRow(person.user_id, person.name, "wants to be friends", [
      smallButton("Accept", () => acceptFriend(person), "primary small"),
      smallButton("Decline", () => removeFriendship(person)),
    ]), "");
  fillList(el("outgoingList"), social.outgoing,
    person => makePersonRow(person.user_id, person.name, "waiting for an answer",
      [smallButton("Cancel", () => removeFriendship(person))]), "");
  el("incomingBox").hidden = social.incoming.length === 0;
  el("outgoingBox").hidden = social.outgoing.length === 0;

  // A little number on "Friends" in the sidebar when requests are waiting
  el("requestBadge").hidden = social.incoming.length === 0;
  el("requestBadge").textContent = social.incoming.length;

  updateAddPartnerButton();
  renderRoomList(); // the "Friends only" room filter depends on my friends
  if (currentRoom) renderMembers();
}

el("navFriends").onclick = () => {
  showView("friendsView");
  loadSocial();
};

// "+ Add friend" in the 1-on-1 chat bar
let partnerUserId = null;
function updateAddPartnerButton() {
  const spot = el("addPartnerBtn");
  if (!partnerUserId) {
    spot.hidden = true;
    return;
  }
  const fresh = makeFriendButton(partnerUserId, partnerName);
  fresh.id = "addPartnerBtn";
  spot.replaceWith(fresh);
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
  showStudyCard();
  await api("/api/flashcards/" + encodeURIComponent(card.word), {
    method: "PATCH",
    body: JSON.stringify({ status, proficiency: card.proficiency }),
  });
}

el("knowItBtn").onclick = () => answerCard("known");
el("stillLearningBtn").onclick = () => answerCard("learning");
el("studyAgainBtn").onclick = () => startStudy(studyDeck);

// Leave study mode: at the end, or halfway through. Cards I already answered are saved.
function exitStudy() {
  if (window.speechSynthesis) speechSynthesis.cancel(); // stop any pronunciation still playing
  renderDecks(); // so the rings show my new progress
  showView("deckView");
}
el("studyBackBtn").onclick = exitStudy;
el("studyExitBtn").onclick = exitStudy;
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

updateMyButtons(); // draw the (crossed-out) mic and camera icons
start(); // run when the page opens
