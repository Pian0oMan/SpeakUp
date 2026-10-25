// QUICK MATCH: finding a partner, the 1-on-1 chat, and icebreakers.

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
  // If I was in a voice room (e.g. I accepted a friend's call), the server took me
  // out of it: close the room's audio links here too
  if (currentRoom) {
    closeRoomPeers();
    currentRoom = null;
    roomMembers = {};
  }
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
