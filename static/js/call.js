// VIDEO / VOICE CALLS (WebRTC) and LIVE CAPTIONS (speech to text).

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

// The mic button works the same in a 1-on-1 call and in a voice room
async function toggleMic() {
  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  } else {
    try {
      micTrack = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
    } catch {
      notice("Couldn't use your microphone. Check your browser permissions.");
      return;
    }
  }
  if (micTrack) startCaptions(); // mic on = live captions on
  else stopCaptions();
  attachMyMedia();                               // 1-on-1 call
  Object.values(roomPeers).forEach(attachRoomMic); // everyone in my voice room
  updateMyButtons();
  if (currentRoom) {
    socket.emit("room_media", { mic: !!micTrack });
    renderMembers();
  } else {
    sendMediaState();
  }
}
el("micBtn").onclick = toggleMic;
el("roomMicBtn").onclick = toggleMic;

// A grey notice in whichever chat I'm in (the 1-on-1 chat or the room's side chat)
function notice(text) {
  if (currentRoom) roomNotice(text);
  else addSystemMessage(text);
}

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
  stopCaptions();
  if (micTrack) micTrack.stop();
  if (camTrack) camTrack.stop();
  micTrack = camTrack = null;
  updateMyButtons();
}

// Red buttons = off. Show my own camera in the corner when it's on.
function updateMyButtons() {
  el("micBtn").classList.toggle("off", !micTrack);
  el("roomMicBtn").classList.toggle("off", !micTrack);
  el("camBtn").classList.toggle("off", !camTrack);
  // Crossed-out icons when they're off
  el("micBtn").innerHTML = el("roomMicBtn").innerHTML = icon(micTrack ? "mic" : "micOff");
  el("camBtn").innerHTML = icon(camTrack ? "camera" : "cameraOff");
  el("localVideo").srcObject = camTrack ? new MediaStream([camTrack]) : null;
  el("localVideo").hidden = !camTrack;
}

// Show my partner's video, or their avatar + a status line when their camera is off
function updatePartnerUI() {
  el("partnerPlaceholder").hidden = callState === "connected" && partnerMedia.cam;
  const mic = partnerMedia.mic ? "Mic on" : "Muted";
  el("callStatus").textContent = {
    connecting: "Connecting...",
    connected: `Camera off · ${mic}`,
    failed: "Couldn't connect the call. Text chat still works.",
    ended: "Your partner left.",
  }[callState];
}


// ---------- LIVE CAPTIONS (speech to text) ----------
// The browser's built-in speech recognition turns what I say into text.
// (Chrome and Edge have it. In Chrome, the audio is processed by Google.)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LOCALES = {
  English: "en-US", Spanish: "es-ES", French: "fr-FR", German: "de-DE",
  Japanese: "ja-JP", Chinese: "zh-CN", Russian: "ru-RU",
};
let recognizer = null;       // the speech recognizer while it's running
let captionsWanted = false;  // should captions be running? (= my mic is on)
let lastCaptionSent = 0;
let warnedNoCaptions = false;

function startCaptions() {
  if (!SpeechRecognition) {
    if (!warnedNoCaptions) notice("Live captions work in Chrome and Edge.");
    warnedNoCaptions = true;
    return;
  }
  captionsWanted = true;
  if (recognizer) return; // already running

  // Which "Speaking" picker counts: the room's one, or the 1-on-1 call's one
  const language = el(currentRoom ? "roomSpeakLang" : "speakLang").value;
  recognizer = new SpeechRecognition();
  recognizer.lang = SPEECH_LOCALES[language];
  recognizer.continuous = true;      // keep listening, don't stop after one sentence
  recognizer.interimResults = true;  // give me words WHILE I'm still talking

  recognizer.onresult = event => {
    let unfinished = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim();
      if (!text) continue;
      if (event.results[i].isFinal) {
        // A finished sentence: my partner sees it, and it goes into the chat
        socket.emit("caption", { text, final: true, language });
      } else {
        unfinished += text + " ";
      }
    }
    unfinished = unfinished.trim();
    // Words so far (sent at most ~3 times a second, so we don't flood the server)
    if (unfinished && Date.now() - lastCaptionSent > 300) {
      lastCaptionSent = Date.now();
      socket.emit("caption", { text: unfinished, final: false, language });
    }
    showMyCaption(unfinished, language); // so I can see it's working
  };

  // Chrome stops listening after a few seconds of silence: just start again
  recognizer.onend = () => {
    recognizer = null;
    showMyCaption("", language);
    if (captionsWanted) setTimeout(startCaptions, 300);
  };
  recognizer.onerror = event => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      captionsWanted = false;
      notice("Live captions need microphone permission.");
    }
  };
  recognizer.start();
}

function stopCaptions() {
  captionsWanted = false;
  if (recognizer) recognizer.stop();
}

// Switching the "Speaking" language: restart the recognizer with the new language
el("speakLang").onchange = el("roomSpeakLang").onchange = () => {
  if (recognizer) recognizer.stop(); // onend starts it again, with the new language
};

// Show a caption, word by word, so words can be hovered for a translation
function showCaption(box, text, language) {
  if (!box) return;
  box.innerHTML = "";
  box.hidden = !text;
  if (text) appendWords(box, text, language);
}

// What I'm saying: over the video in a 1-on-1 call, or on my own tile in a room
function showMyCaption(text, language) {
  showCaption(el(currentRoom ? "myRoomCaption" : "myCaption"), text, language);
}

// My partner is talking: show their words, then hide them after 4 seconds of quiet
let captionTimer;
socket.on("caption", caption => {
  showCaption(el("partnerCaption"), caption.text, caption.language);
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => showCaption(el("partnerCaption"), "", null), 4000);
});
