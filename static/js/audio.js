// PRONUNCIATION: real recordings for words, the best computer voice otherwise.

// ---------- PRONUNCIATION ----------
// The browser can read text out loud ("speech synthesis"), free, built into Chrome,
// Edge, Safari and Firefox. It uses voices installed on the computer or phone.
const SPEAKER_ICON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
document.querySelectorAll(".speak-btn").forEach(button => (button.innerHTML = SPEAKER_ICON));

function makeSpeakButton(text, language) {
  const button = document.createElement("button");
  button.className = "speak-btn";
  button.title = "Listen";
  button.innerHTML = SPEAKER_ICON;
  button.onclick = event => {
    event.stopPropagation(); // don't also trigger whatever is under the button
    speak(text, language);
  };
  return button;
}

// If we don't know the language, guess from the writing system (or use what I'm learning)
function guessLanguage(text) {
  if (/[぀-ヿ]/.test(text)) return "Japanese";
  if (/[Ѐ-ӿ]/.test(text)) return "Russian";
  if (/[一-鿿]/.test(text)) return profile.learning === "Chinese" ? "Chinese" : "Japanese";
  return profile.learning;
}

// 1. A single word: try a REAL PERSON's recording first (from Wiktionary)
// 2. Otherwise (sentences, rare words): the best computer voice on this device
const recordingCache = {}; // "hola|Spanish" -> audio link, or null if there's no recording
let nowPlaying = null;

async function speak(text, language) {
  if (!text) return;
  language = language || guessLanguage(text);
  stopSpeaking();

  if (!/\s/.test(text.trim())) {  // a single word (no spaces)
    const key = text + "|" + language;
    if (!(key in recordingCache)) {
      try {
        const params = new URLSearchParams({ word: text, language });
        recordingCache[key] = (await api("/api/pronounce?" + params)).url;
      } catch {
        recordingCache[key] = null;
      }
    }
    if (recordingCache[key]) {
      nowPlaying = new Audio(recordingCache[key]);
      try {
        await nowPlaying.play();
        return; // a real person said it!
      } catch {
        // the recording didn't play: use the computer voice below instead
      }
    }
  }
  speakWithVoice(text, language);
}

function stopSpeaking() {
  if (nowPlaying) nowPlaying.pause();
  if (window.speechSynthesis) speechSynthesis.cancel();
}

function speakWithVoice(text, language) {
  if (!window.speechSynthesis) {
    showToast("Your browser can't read words out loud.");
    return;
  }
  const lang = SPEECH_LOCALES[language];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = bestVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9; // a little slower than normal, easier for learners
  speechSynthesis.speak(utterance);
}

// Computers have many voices, and the first one is often old and robotic.
// Give each voice for this language points, and pick the winner:
//   "Natural" / "Neural" voices (Edge) sound almost human, "Google" voices (Chrome) are good,
//   online voices beat offline ones, and the exact accent (es-ES) beats a close one (es-MX).
function bestVoice(lang) {
  const base = lang.slice(0, 2);
  let best = null;
  let bestScore = -1;
  speechSynthesis.getVoices().forEach(voice => {
    const voiceLang = voice.lang.replace("_", "-");
    if (!voiceLang.startsWith(base)) return; // wrong language
    let score = 0;
    if (/natural|neural/i.test(voice.name)) score += 10;
    if (/google/i.test(voice.name)) score += 6;
    if (/online/i.test(voice.name) || voice.localService === false) score += 3;
    if (voiceLang === lang) score += 2;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  });
  return best;
}
// The voice list loads a moment after the page opens: ask for it early
if (window.speechSynthesis) speechSynthesis.getVoices();

el("popupSpeakWord").onclick = () => speak(popupWord.word, popupWord.language);
el("popupSpeakPhrase").onclick = () => speak(popupWord.phrase, popupWord.language);
el("studySpeakWord").onclick = () => {
  const card = studyCards[studyIndex];
  speak(card.word, card.language);
};
el("studySpeakExample").onclick = () => {
  const card = studyCards[studyIndex];
  speak(card.example, card.language);
};
