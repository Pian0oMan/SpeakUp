// JAVASCRIPT = the BEHAVIOR. It reacts to clicks and talks to the backend.

let sb;                  // Supabase client: handles logging in
let token = null;        // my login "ID card", sent to our server to prove who I am
let loggedIn = false;
let registering = false; // true while "Create account" is still saving the profile
let profile = null;      // my name + languages
let messages = [];       // chat messages with the current partner
let deck = {};           // { "hola": "#ffd54f", ... }  word -> color
let partnerName = "";

const LANGUAGES = ["English", "Spanish", "French", "German", "Japanese", "Chinese", "Russian"];

// Shortcut so we don't type document.getElementById a hundred times
const el = id => document.getElementById(id);

// Fill every language dropdown from the list above (so we only write the list once)
document.querySelectorAll(".lang-select").forEach(select => {
  LANGUAGES.forEach(lang => select.add(new Option(lang, lang)));
});
el("regLearning").value = "Spanish";

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
  el("nativeChip").textContent = profile.native;
  el("learningChip").textContent = profile.learning;
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
  }
  el("profileStatus").textContent = message;
  showView("profileView");
}

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


// ---------- FLASHCARDS ----------
// 1. Ask the backend for MY saved flashcards, then draw everything
async function loadDeck() {
  const cards = await api("/api/flashcards"); // HTTP GET
  deck = {};
  cards.forEach(card => (deck[card.word] = card.color));
  render();
}

// 2. Save a word (HTTP POST with JSON body)
async function saveWord(word) {
  const color = el("colorPicker").value;
  await api("/api/flashcards", { method: "POST", body: JSON.stringify({ word, color }) });
  loadDeck();
}

// 3. Remove a word (HTTP DELETE)
async function deleteWord(word) {
  await api("/api/flashcards/" + encodeURIComponent(word), { method: "DELETE" });
  loadDeck();
}

// Turn "Hola!" into "hola" so punctuation doesn't matter
function clean(word) {
  return word.toLowerCase().replace(/[^\p{L}]/gu, "");
}


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
    msg.text.split(" ").forEach(raw => {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = raw + " ";
      const key = clean(raw);
      if (deck[key]) span.style.color = deck[key]; // ⭐ the highlight!
      span.onclick = () => saveWord(key);
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

  document.querySelectorAll(".deck-list").forEach(list => {
    list.innerHTML = "";
    if (Object.keys(deck).length === 0) {
      list.innerHTML = "<li>No words yet. Click words in a chat to save them!</li>";
    }
    Object.entries(deck).forEach(([word, color]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="swatch" style="background:${color}">${word}</span>`;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.onclick = () => deleteWord(word);
      li.appendChild(del);
      list.appendChild(li);
    });
  });
}

start(); // run when the page opens
