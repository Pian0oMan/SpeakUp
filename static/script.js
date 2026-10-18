// JAVASCRIPT = the BEHAVIOR. It reacts to clicks and talks to the backend.

let sb;              // Supabase client: handles logging in
let token = null;    // my login "ID card", sent to our server to prove who I am
let loggedIn = false;
let profile = null;  // my name + languages
let messages = [];   // chat messages with the current partner
let deck = {};       // { "hola": "#ffd54f", ... }  word -> color
let partnerName = "";

const LANGUAGES = ["English", "Spanish", "French", "German", "Japanese", "Chinese", "Russian"];

// Shortcut so we don't type document.getElementById a hundred times
const el = id => document.getElementById(id);

// Fill the three dropdowns from the list above (so we only write the list once)
["nativeSelect", "learningSelect", "translateSelect"].forEach(id => {
  LANGUAGES.forEach(lang => el(id).add(new Option(lang, lang)));
});
el("learningSelect").value = "Spanish";

// REAL-TIME: open an always-on connection to the server
const socket = io();

// Show one screen, hide the others
function showScreen(id) {
  ["authScreen", "lobby", "chatScreen"].forEach(screen => (el(screen).hidden = screen !== id));
  el("logoutBtn").hidden = id === "authScreen";
}

// Talk to OUR server (Flask), always including the login token
async function api(path, options = {}) {
  options.headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const response = await fetch(path, options);
  return response.json();
}


// ---------- LOGIN (Supabase) ----------
async function start() {
  const config = await (await fetch("/api/config")).json();
  sb = supabase.createClient(config.url, config.anonKey);

  // Runs whenever login state changes: page load, log in, log out, token refresh
  sb.auth.onAuthStateChange((event, session) => {
    token = session ? session.access_token : null;
    if (session && !loggedIn) {
      loggedIn = true;
      enterLobby();
    } else if (!session) {
      loggedIn = false;
      showScreen("authScreen");
    }
  });
}

el("authForm").onsubmit = async event => {
  event.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: el("emailInput").value,
    password: el("passwordInput").value,
  });
  el("authStatus").textContent = error ? error.message : "";
};

el("signupBtn").onclick = async () => {
  const { data, error } = await sb.auth.signUp({
    email: el("emailInput").value,
    password: el("passwordInput").value,
  });
  if (error) el("authStatus").textContent = error.message;
  else if (!data.session) el("authStatus").textContent = "Check your email to confirm your account, then log in.";
};

el("logoutBtn").onclick = () => {
  endCall();
  socket.emit("leave");
  sb.auth.signOut();
};


// ---------- LOBBY ----------
async function enterLobby() {
  profile = await api("/api/profile");
  if (profile) {  // returning user: fill in their saved choices
    el("nameInput").value = profile.username;
    el("nativeSelect").value = profile.native;
    el("learningSelect").value = profile.learning;
    el("translateSelect").value = profile.translate_to;
  }
  el("status").textContent = "";
  showScreen("lobby");
  loadDeck();
}

el("lobbyForm").onsubmit = async event => {
  event.preventDefault();
  profile = {
    username: el("nameInput").value.trim(),
    native: el("nativeSelect").value,
    learning: el("learningSelect").value,
    translate_to: el("translateSelect").value,
  };
  if (profile.native === profile.learning) {
    el("status").textContent = "Pick two different languages!";
    return;
  }
  await api("/api/profile", { method: "PUT", body: JSON.stringify(profile) }); // save to database
  findPartner();
};

function findPartner() {
  endCall(); // hang up any video call with the old partner
  socket.emit("find_partner", { token });
  showScreen("lobby");
  el("status").textContent =
    `Looking for someone who speaks ${profile.learning} and is learning ${profile.native}...`;
}

// NEXT: leave this partner and look for a new one
el("nextBtn").onclick = findPartner;


// ---------- CHAT ----------
// The server found us a partner!
socket.on("matched", partner => {
  messages = [];
  nextIcebreakerAt = 0;
  partnerName = partner.name;
  el("partnerInfo").textContent =
    `💬 ${partner.name} · speaks ${partner.native} · learning ${partner.learning}`;
  showScreen("chatScreen");
  render();
});

// Our partner clicked Next or closed their tab
socket.on("partner_left", () => {
  messages.push({ from: "system", text: "Your partner left. Click Next to find someone new." });
  nextIcebreakerAt = 0; // no more questions in this chat
  endCall();
  render();
});

// A new chat message (from me or my partner), with its translation
socket.on("chat_message", msg => {
  messages.push(msg);
  el("typing").textContent = ""; // they sent it, so they're done typing
  render();
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


// ---------- VIDEO CALLS (WebRTC) ----------
// The video and audio go DIRECTLY between the two browsers. Our server only
// passes small "call" messages so the browsers can find each other ("signaling").
let peer = null;        // RTCPeerConnection: the direct browser-to-browser link
let localStream = null; // my camera + microphone

// A free public "STUN" server tells each browser its address on the internet
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function sendCall(data) {
  socket.emit("call", data);
}

function addSystemMessage(text) {
  messages.push({ from: "system", text });
  render();
}

// Turn on my camera + microphone (or just the microphone if there's no camera)
async function startMedia() {
  if (localStream) return; // already on
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); // voice-only call
  }
  el("localVideo").srcObject = localStream;
  el("camBtn").hidden = localStream.getVideoTracks().length === 0;
  el("callArea").hidden = false;
  el("callBtn").hidden = true;
}

// Create the direct link and connect my camera/mic to it
function createPeer() {
  peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  // My browser found a possible route to me: tell my partner about it
  peer.onicecandidate = event => {
    if (event.candidate) sendCall({ type: "candidate", candidate: event.candidate });
  };
  // My partner's video/audio arrived: show it
  peer.ontrack = event => {
    el("remoteVideo").srcObject = event.streams[0];
  };
}

// Hang up and switch off the camera
function endCall() {
  if (peer) peer.close();
  peer = null;
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  el("localVideo").srcObject = null;
  el("remoteVideo").srcObject = null;
  el("callArea").hidden = true;
  el("callInvite").hidden = true;
  el("callBtn").hidden = false;
  el("micBtn").textContent = "🎤 Mute";
  el("camBtn").textContent = "📷 Camera off";
}

// 1. I click "Call": turn on my camera and invite my partner
el("callBtn").onclick = async () => {
  try {
    await startMedia();
  } catch {
    addSystemMessage("Couldn't use your microphone. Check your browser permissions.");
    return;
  }
  sendCall({ type: "invite" });
  addSystemMessage(`Calling ${partnerName}...`);
};

// 2. My partner accepts: turn on my camera and get ready for their offer
el("acceptCallBtn").onclick = async () => {
  el("callInvite").hidden = true;
  try {
    await startMedia();
  } catch {
    addSystemMessage("Couldn't use your microphone. Check your browser permissions.");
    sendCall({ type: "decline" });
    return;
  }
  createPeer();
  sendCall({ type: "accept" });
};

el("declineCallBtn").onclick = () => {
  el("callInvite").hidden = true;
  sendCall({ type: "decline" });
};

el("endCallBtn").onclick = () => {
  endCall();
  sendCall({ type: "end" });
  addSystemMessage("Call ended.");
};

// Mute / unmute: the track stays connected, it just sends silence (or black video)
el("micBtn").onclick = () => {
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  el("micBtn").textContent = track.enabled ? "🎤 Mute" : "🔇 Unmute";
};
el("camBtn").onclick = () => {
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  el("camBtn").textContent = track.enabled ? "📷 Camera off" : "📷 Camera on";
};

// Messages from my partner's browser, passed along by the server
async function handleCall(data) {
  if (data.type === "invite") {
    el("callInviteText").textContent = `📞 ${partnerName} wants to video call`;
    el("callInvite").hidden = false;
  } else if (data.type === "decline") {
    endCall();
    addSystemMessage(`${partnerName} declined the call.`);
  } else if (data.type === "end") {
    endCall();
    addSystemMessage(`${partnerName} ended the call.`);
  } else if (data.type === "accept") {
    // 3. They accepted: I create an "offer" describing my video/audio
    el("callInvite").hidden = true;
    createPeer();
    await peer.setLocalDescription(await peer.createOffer());
    sendCall({ type: "offer", description: peer.localDescription });
  } else if (data.type === "offer" && peer) {
    // 4. They reply with an "answer" describing theirs
    await peer.setRemoteDescription(data.description);
    await peer.setLocalDescription(await peer.createAnswer());
    sendCall({ type: "answer", description: peer.localDescription });
  } else if (data.type === "answer" && peer) {
    await peer.setRemoteDescription(data.description);
  } else if (data.type === "candidate" && peer) {
    await peer.addIceCandidate(data.candidate);
  }
}

// Handle call messages ONE AT A TIME, in the order they arrived
// (e.g. a "candidate" must never be handled before the "offer" it belongs to)
let callQueue = Promise.resolve();
socket.on("call", data => {
  callQueue = callQueue.then(() => handleCall(data)).catch(error => console.error("Call error:", error));
});

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

  const list = el("deckList");
  list.innerHTML = "";
  Object.entries(deck).forEach(([word, color]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="swatch" style="background:${color}">${word}</span>`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => deleteWord(word);
    li.appendChild(del);
    list.appendChild(li);
  });
}

start(); // run when the page opens
