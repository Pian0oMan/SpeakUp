// FRIENDS, RECENT CONTACTS, and who's ONLINE.

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
      // An online friend gets a "Call" button, everyone else the friend button
      [relationTo(person.user_id) === "friend" && onlineIds.has(person.user_id)
        ? callButton(person.user_id, person.name)
        : makeFriendButton(person.user_id, person.name)]),
    "People you chat with show up here."));

  // FRIENDS PAGE
  fillList(el("friendsList"), social.friends,
    person => makePersonRow(person.user_id, person.name, online(person.user_id), [
      ...(onlineIds.has(person.user_id) ? [callButton(person.user_id, person.name)] : []),
      smallButton("Remove", () => removeFriendship(person, `Remove ${person.name} from your friends?`)),
    ]),
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
