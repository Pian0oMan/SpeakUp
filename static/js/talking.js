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

setInterval(() => {
  const now = Date.now();
  Object.entries(voiceMeters).forEach(([who, meter]) => {
    if (volumeOf(meter) > LOUD_ENOUGH) meter.lastLoud = now;
    lightUp(who, now - meter.lastLoud < STAY_LIT);
  });
}, 100);
