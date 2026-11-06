// THE APP SHELL: home page, profile, and the sidebar buttons.

// ---------- MAIN MENU, PROFILE, DECK ----------
async function enterApp() {
  loggedIn = true;
  profile = await api("/api/profile");
  // First time here, or I haven't answered the welcome questions yet: ask them first.
  // (No "fluency" in the profile at all = 09_onboarding.sql hasn't been run: skip them)
  if (!profile || (profile.fluency === null && "fluency" in profile)) return startOnboarding();
  await loadDeck();
  sayHello();     // so my friends see me online
  markSeen();     // for "Last online 5 min ago"
  loadSocial();   // friends + recent people
  loadProgress(); // level, XP, streak
  loadSpeaking(); // minutes spoken this week
  openMenu();
}

// Show the app (sidebar + content) with one view: homeView, deckView or profileView
function showView(id) {
  // Leaving study mode (with Exit OR a sidebar button): redraw my progress
  if (!el("studyView").hidden && id !== "studyView") leaveStudy();
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
  updateTalkPanel();
  showView("homeView");
}

// ---------- TALK NOW: one panel, two ways to talk ----------
// "1-on-1" = Quick Match (a partner who speaks what I'm learning), "Group room" = a random
// voice room in that language. The switch changes the text, the color and the Start button.
let talkMode = "match";

function setTalkMode(mode) {
  talkMode = mode;
  [["modeMatch", "match"], ["modeRoom", "room"]].forEach(([id, value]) => {
    el(id).classList.toggle("on", mode === value);
    el(id).setAttribute("aria-pressed", mode === value);
  });
  updateTalkPanel();
}
el("modeMatch").onclick = () => setTalkMode("match");
el("modeRoom").onclick = () => setTalkMode("room");

function updateTalkPanel() {
  if (!profile) return;
  const room = talkMode === "room";
  el("talkPanel").classList.toggle("room", room);
  el("talkTitle").textContent = room
    ? `Jump into a ${profile.learning} voice room`
    : `Talk to someone who speaks ${profile.learning}`;
  el("talkText").textContent = room
    ? "A group conversation with up to 10 people. Talk, or just listen and use the side chat."
    : `Video, voice or text. They're learning ${profile.native}, so you help each other.`;
  el("matchLive").hidden = room;
  el("roomsLive").hidden = !room;
  el("talkStartBtn").innerHTML = (room ? "Join a room" : "Start talking") + icon("next");
  el("talkMascot").innerHTML = mascot(room ? "excited" : "wave", 150);
}

el("talkStartBtn").onclick = () => {
  if (talkMode === "room") socket.emit("join_random_room", { token, language: profile.learning });
  else findPartner();
};

function openProfile(message) {
  if (profile) {
    el("profName").value = profile.username;
    el("profNative").value = profile.native;
    el("profLearning").value = profile.learning;
    el("profTranslate").value = profile.translate_to;
    el("profCountry").value = profile.country || "";
    el("profFluency").value = profile.fluency || "";
    el("profStudying").value = profile.studying_for || "";
    fillInterestPicker(el("profInterests"), profile.interests || []);
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
    updateTalkPanel(); // "Talk to someone who speaks ..."
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
