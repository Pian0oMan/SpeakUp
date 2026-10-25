// INVITES: invite friends to the voice room I'm in, or call a friend 1-on-1.
// The server checks that we're friends, so strangers can't send invites.

// ---------- SENDING ----------
// "Invite friends" (in a voice room): a list of my friends, online ones first
el("inviteFriendsBtn").onclick = () => {
  renderInviteList();
  el("inviteDialog").showModal();
  askWhoIsOnline(); // fresh green dots
};

function renderInviteList() {
  const friends = [...social.friends].sort((a, b) => onlineIds.has(b.user_id) - onlineIds.has(a.user_id));
  fillList(el("inviteList"), friends, friend => {
    const isOnline = onlineIds.has(friend.user_id);
    const button = smallButton(isOnline ? "Invite" : "Offline", () => {
      socket.emit("invite", { to: friend.user_id, kind: "room" });
      button.textContent = "Invited";
      button.disabled = true;
    }, isOnline ? "primary small" : "ghost small");
    button.disabled = !isOnline;
    return makePersonRow(friend.user_id, friend.name, isOnline ? "Online" : "Offline", [button]);
  }, "No friends yet. Add people you meet from your Recent list.");
}
socket.on("online", () => {
  if (el("inviteDialog").open) renderInviteList(); // the green dots changed
});

// "Call" (for online friends): ask them to start a 1-on-1 chat + call with me
function callButton(userId, name) {
  return smallButton("Call", () => {
    socket.emit("invite", { to: userId, kind: "call" });
    showToast(`Calling ${name}...`);
  }, "primary small");
}

socket.on("invite_sent", data => {
  if (data.kind === "room") showToast("Invite sent!");
});
socket.on("invite_error", message => showToast(message));
socket.on("call_declined", name => showToast(`${name} can't talk right now.`));


// ---------- RECEIVING ----------
// A card in the corner: "Yuki invited you to Anime & Manga Talk" -> Join / Not now
let currentInvite = null;
let inviteTimer;

socket.on("invited", invite => {
  currentInvite = invite;
  const isRoom = invite.kind === "room";
  el("inviteMascot").innerHTML = mascot(isRoom ? "excited" : "wave", 44);
  el("inviteTitle").textContent = isRoom ? `${invite.from} invited you` : `${invite.from} wants to call you`;
  el("inviteDetail").textContent = isRoom ? `to ${invite.room_name} (${invite.language})` : "1-on-1 video or voice chat";
  el("inviteYesBtn").textContent = isRoom ? "Join" : "Accept";
  el("inviteNoBtn").textContent = isRoom ? "Not now" : "Decline";
  el("inviteCard").hidden = false;
  // Ignored for 30 seconds: it goes away (a call counts as declined)
  clearTimeout(inviteTimer);
  inviteTimer = setTimeout(() => answerInvite(false), 30000);
});

function answerInvite(yes) {
  if (!currentInvite) return;
  clearTimeout(inviteTimer);
  el("inviteCard").hidden = true;
  if (currentInvite.kind === "room") {
    if (yes) socket.emit("join_room", { token, room_id: currentInvite.room_id });
  } else {
    // Accepting a call: the server starts the chat, and "matched" opens it (like Quick Match)
    if (yes) stopMyMedia();
    socket.emit("answer_call", { from_user: currentInvite.from_user, accept: yes });
  }
  currentInvite = null;
}
el("inviteYesBtn").onclick = () => answerInvite(true);
el("inviteNoBtn").onclick = () => answerInvite(false);
