// WHO'S TALKING: listen to each person's audio VOLUME and light them up while they speak
// (like the green ring in Discord). Works for everyone in a voice room, for me,
// and for my partner in a 1-on-1 call, even when captions are off.
//
// The Web Audio API's "analyser" gives us the sound wave ~10 times a second;
// we measure how loud it is, and if it's loud enough, that person is talking.

let audioContext = null;
const voiceMeters = {}; // who -> { source, analyser, samples, lastLoud }
                        // who = a voice room member's sid, "me", or "partner" (1-on-1)
const LOUD_ENOUGH = 0.02;   // volume (0 to 1) that counts as talking, not just background noise
                            // (raise it if quiet background noise lights people up)
const STAY_LIT = 400;       // milliseconds: stay lit for a moment between words

function watchVoice(who, stream) {
  stopWatchingVoice(who);
  if (!stream || stream.getAudioTracks().length === 0) return;
  audioContext = audioContext || new AudioContext();
  audioContext.resume().catch(() => {}); // browsers start audio "paused" until you click something
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser); // only measured, NOT played again (the <audio> element plays it)
  voiceMeters[who] = { source, analyser, samples: new Uint8Array(analyser.fftSize), lastLoud: 0 };
}

function stopWatchingVoice(who) {
  const meter = voiceMeters[who];
  if (!meter) return;
  meter.source.disconnect();
  delete voiceMeters[who];
  lightUp(who, false);
}

function stopWatchingAllVoices() {
  Object.keys(voiceMeters).forEach(stopWatchingVoice);
}

// How loud is it right now? (0 = silence, 1 = as loud as possible)
function volumeOf(meter) {
  meter.analyser.getByteTimeDomainData(meter.samples); // the sound wave: numbers around 128
  let sum = 0;
  for (const sample of meter.samples) {
    const wave = (sample - 128) / 128;
    sum += wave * wave;
  }
  return Math.sqrt(sum / meter.samples.length); // "RMS": the average loudness
}

// The tile (or avatar) that belongs to someone
function lightUp(who, talking) {
  const spot = who === "partner" ? el("partnerAvatar") : el(who === "me" ? "tile-me" : "tile-" + who);
  if (spot) spot.classList.toggle("speaking", talking);
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  // Real time since the last check (browsers slow timers down in background tabs)
  const passed = Math.min(now - lastTick, 1000);
  lastTick = now;
  Object.entries(voiceMeters).forEach(([who, meter]) => {
    if (volumeOf(meter) > LOUD_ENOUGH) meter.lastLoud = now;
    const talking = now - meter.lastLoud < STAY_LIT;
    lightUp(who, talking);
    if (who === "me" && talking) countMySpeech(passed);
  });
}, 100);


// ---------- SPEAKING TIME ----------
// While MY voice lights up, count the time, per language I'm speaking (the "Speaking"
// picker). It's sent to the server every 30 seconds (see backend/speaking.py).
let unsentSpeech = {}; // language -> milliseconds not sent yet, e.g. { Japanese: 12400 }

function countMySpeech(ms) {
  const language = el(currentRoom ? "roomSpeakLang" : "speakLang").value;
  if (!language) return;
  unsentSpeech[language] = (unsentSpeech[language] || 0) + ms;
  noteSpeech(ms); // for the recap at the end of the conversation
}

// Send the whole seconds; the rest waits for next time
function sendSpeech() {
  const report = {};
  let total = 0;
  Object.entries(unsentSpeech).forEach(([language, ms]) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds > 0) {
      report[language] = seconds;
      unsentSpeech[language] = ms - seconds * 1000;
      total += seconds;
    }
  });
  if (!total) return;
  socket.emit("spoken", report);
  addSpokenSeconds(total); // the home page counts up right away
}
setInterval(sendSpeech, 30000);
