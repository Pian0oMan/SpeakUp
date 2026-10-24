// VOICE ROOMS: the room list, filters, group audio, and the side chat.

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
