// THE APP SHELL: home page, profile, and the sidebar buttons.

// ---------- MAIN MENU, PROFILE, DECK ----------
async function enterApp() {
  loggedIn = true;
  profile = await api("/api/profile");
  await loadDeck();
  sayHello();     // so my friends see me online
  markSeen();     // for "Last online 5 min ago"
  loadSocial();   // friends + recent people
  loadProgress(); // level, XP, streak
  if (profile) openMenu();
  else openProfile("Welcome! Pick your languages to get started."); // e.g. confirmed by email
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
  showView("homeView");
}

function openProfile(message) {
  if (profile) {
    el("profName").value = profile.username;
    el("profNative").value = profile.native;
    el("profLearning").value = profile.learning;
    el("profTranslate").value = profile.translate_to;
    el("profCountry").value = profile.country || "";
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
