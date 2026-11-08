// QUICK MATCH: finding a partner, the 1-on-1 chat, and icebreakers.

// ---------- MATCHING ----------
// (The home page's Start button is in menu.js: it does Quick Match OR a voice room)
el("nextBtn").onclick = findPartner;    // leave this partner and find a new one
el("menuBtn").onclick = leaveChat;
el("cancelSearchBtn").onclick = leaveChat;

function findPartner() {
  inChat = false;
  hangUp(); // end the video link with the old partner (my camera/mic stay as they were)
  socket.emit("find_partner", { token });
  el("searchStatus").textContent =
    `Looking for someone who speaks ${profile.learning} and is learning ${profile.native}...`;
  el("searchRoomBtn").hidden = true;
  updateQueueLive();
  showScreen("searchScreen");
  endSession(); // clicked Next: the recap of the last chat shows while I wait
}

// Leave the chat (or the search) and go back to the menu
function leaveChat() {
  inChat = false;
  socket.emit("leave");
  hangUp();
  stopMyMedia(); // switch off camera + mic
  nextIcebreakerAt = 0;
  openMenu();
  endSession(); // the recap of this chat (if there was one)
}

// ---------- WHO'S WAITING ----------
// The server sends how many people are waiting, per language pair, e.g. {"Japanese>English": 2}
// (2 people who speak Japanese and are learning English). Shown on Quick Match and while searching.
let queueCounts = {};
socket.on("queue", counts => {
  queueCounts = counts;
  updateQueueLive();
});

function updateQueueLive() {
  if (!profile) return;
  const perfect = queueCounts[`${profile.learning}>${profile.native}`] || 0; // they'd match me right away
  const speakers = Object.entries(queueCounts)
    .filter(([pair]) => pair.startsWith(profile.learning + ">"))
    .reduce((sum, [, count]) => sum + count, 0);
  const text = perfect
    ? `${perfect} ${perfect === 1 ? "person is" : "people are"} waiting for a partner like you`
    : speakers
      ? `${speakers} ${profile.learning} ${speakers === 1 ? "speaker is" : "speakers are"} looking for a partner`
      : `Nobody's waiting right now. Be the first in line for ${profile.learning}!`;
  el("matchLive").textContent = text;
  el("searchQueue").textContent = text;
}

// I've waited a while: the server now also tries "good enough" partners
socket.on("search_relaxed", () => {
  el("searchStatus").textContent = `Still looking... We'll also match you with a native ${profile.learning} ` +
    `speaker who's learning something else, or another ${profile.learning} learner.`;
  el("searchRoomBtn").hidden = false;
});
el("searchRoomBtn").onclick = () => socket.emit("join_random_room", { token, language: profile.learning });

// Not a perfect language exchange? Say what kind of match it is.
function matchNote(partner) {
  if (partner.match === "half" && partner.native === profile.learning) {
    return `No exchange partner was free, so we found you a native ${profile.learning} speaker. Enjoy the practice!`;
  }
  if (partner.match === "half") {
    return `${partner.name} is learning ${profile.native}, your language. No exchange partner was free, so help them out!`;
  }
  if (partner.match === "peers") return `You're both learning ${profile.learning}. Practice it together!`;
  return "";
}


// ---------- CHAT ----------
// The server found us a partner!
socket.on("matched", partner => {
  // If I was in a voice room (e.g. I accepted a friend's call), the server took me
  // out of it: close the room's audio links here too
  if (currentRoom) {
    closeRoomPeers();
    currentRoom = null;
    roomMembers = {};
  }
  inChat = true;
  messages = [];
  nextIcebreakerAt = 0;
  partnerName = partner.name;
  partnerUserId = partner.user_id;
  updateAddPartnerButton(); // "+ Add friend" (or "Friends" if we already are)
  el("partnerInfo").replaceChildren(partner.name + " ", languageTag(partner.native, partner.learning));
  if (partner.fluency) el("partnerInfo").append(" ", fluencyTag(partner.fluency));
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
  startSession(`with ${partner.name}`); // for the recap at the end
  const note = matchNote(partner);
  if (note) addSystemMessage(note);
  // Something to talk about: what we both like
  const both = sharedInterests(partner.interests);
  if (both.length) addSystemMessage(`You both like ${interestList(both)}.`);
  startCall(partner.initiator); // join the call automatically
});

// Our partner clicked Next or closed their tab
socket.on("partner_left", () => {
  if (!inChat) return; // e.g. I already left this chat myself
  inChat = false;
  addSystemMessage("Your partner left. Click Next to find someone new.");
  nextIcebreakerAt = 0; // no more questions in this chat
  hangUp();
  callState = "ended";
  updatePartnerUI();
});

// ---------- LOST CONNECTION ----------
// My partner's connection dropped: the server waits a few seconds for them to come back
socket.on("partner_reconnecting", () => {
  addSystemMessage(`${partnerName} lost their connection. Waiting for them to come back...`);
});

// Messages and answered questions remember WHO sent them by connection id.
// After a reconnect, that person has a new id: swap it everywhere.
function swapSid(oldSid, newSid) {
  messages.forEach(msg => {
    if (msg.from === oldSid) msg.from = newSid;
    if (msg.answered) msg.answered = msg.answered.map(id => (id === oldSid ? newSid : id));
  });
  render();
}

socket.on("partner_back", ({ old_sid, sid }) => {
  swapSid(old_sid, sid);
  addSystemMessage(`${partnerName} is back!`);
  repairCall(); // their network may have changed: reconnect the call if it broke
});

// MY connection dropped and came back, and I'm still in the same chat
socket.on("chat_resumed", ({ old_sid }) => {
  swapSid(old_sid, socket.id);
  addSystemMessage("You lost your connection for a moment, but you're back in the chat.");
  repairCall();
});

// My connection dropped while I was waiting for a partner: the server took me out
// of the line, so get back in it
socket.on("connect", () => {
  if (loggedIn && !el("searchScreen").hidden) socket.emit("find_partner", { token });
});

// A new chat message (from me or my partner), with its translation
socket.on("chat_message", msg => {
  if (msg.from === socket.id) noteSentMessage(); // for the recap
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
