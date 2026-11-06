// SAFETY: report or block someone, from a 1-on-1 chat, a voice room or the Discover feed.
// Blocked people are never matched with me again, stop being my friend, are hidden
// from my lists and the feed, and are muted in voice rooms. They're never told.
// (The server side is in backend/safety.py and backend/social.py.)

let reportingUser = null; // who the report window is about: { user_id, name, where }

function openUserReport(userId, name, where) {
  if (!userId) return;
  reportingUser = { user_id: userId, name, where };
  el("userReportTitle").textContent = `Report or block ${name}`;
  el("userReportBlockText").textContent = `Block ${name}: you'll never be matched again`;
  el("userReportReason").value = "";
  el("userReportDetails").value = "";
  el("userReportBlock").checked = true;
  el("userReportStatus").textContent = "";
  el("userReportSend").disabled = false;
  el("userReportDialog").showModal();
}

el("reportPartnerBtn").onclick = () => openUserReport(partnerUserId, partnerName, "chat");

el("userReportForm").onsubmit = event => {
  event.preventDefault();
  const reason = el("userReportReason").value;
  const block = el("userReportBlock").checked;
  if (!reason && !block) {
    el("userReportStatus").textContent = "Pick what happened, or tick Block.";
    return;
  }
  el("userReportSend").disabled = true;
  // Through the real-time connection, so the server can attach the conversation it relayed
  socket.emit("report_user", {
    token,
    user_id: reportingUser.user_id,
    name: reportingUser.name,
    reason,
    details: el("userReportDetails").value.trim(),
    block,
    where: reportingUser.where,
  });
};

socket.on("report_done", result => {
  const name = reportingUser ? reportingUser.name : "them";
  el("userReportDialog").close();
  showToast(result.reported && result.blocked ? `Thanks for reporting. You won't see ${name} again.`
    : result.reported ? "Thanks for reporting. The team will look at it."
    : `${name} is blocked.`);
  if (result.ended_chat) {
    // I blocked my chat partner: the server ended the chat
    addSystemMessage(`You blocked ${name}. Click Next to find someone new.`);
    nextIcebreakerAt = 0;
    hangUp();
    callState = "ended";
    updatePartnerUI();
    partnerUserId = null;
    updateAddPartnerButton();
  }
  loadSocial(); // the Blocked list, and room tiles get muted
});

socket.on("report_error", message => {
  el("userReportStatus").textContent = message;
  el("userReportSend").disabled = false;
});

// Did I block this person?
function isBlocked(userId) {
  return (social.blocked || []).some(person => person.user_id === userId);
}

async function unblock(person) {
  await api(`/api/blocks/${person.user_id}`, { method: "DELETE" });
  showToast(`${person.name} is unblocked`);
  loadSocial();
}

// A small flag button for someone's tile or post
function reportButton(userId, name, where) {
  const button = document.createElement("button");
  button.className = "report-btn";
  button.title = `Report or block ${name}`;
  button.innerHTML = icon("flag");
  button.onclick = event => {
    event.stopPropagation();
    openUserReport(userId, name, where);
  };
  return button;
}
