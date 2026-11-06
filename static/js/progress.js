// XP, LEVELS, STREAKS: the sidebar box, the Today card, level-up celebrations.

// ---------- XP, LEVELS, STREAKS ----------
async function loadProgress() {
  try {
    showProgress(await api("/api/progress"));
  } catch {
    // e.g. the progress SQL hasn't been run yet
  }
}

// Draw the sidebar box and the home page "Today" card
function showProgress(p) {
  if (p.xp === undefined) return;
  const intoLevel = p.xp - p.level_start;
  const levelSize = p.level_end - p.level_start;
  el("levelBadge").textContent = `Lv ${p.level}`;
  el("streakCount").textContent = p.streak;
  el("streakBadge").classList.toggle("lit", p.streak > 0); // grey flame when there's no streak
  el("xpFill").style.width = `${(intoLevel / levelSize) * 100}%`;
  el("xpText").textContent = `${intoLevel} / ${levelSize} XP`;

  setRing(el("goalRing"), Math.min(100, (p.xp_today / p.daily_goal) * 100));
  // Short values (they never wrap), with the details in the label underneath
  el("goalText").textContent = `${p.xp_today} / ${p.daily_goal}`;
  el("todayStreak").textContent = `${p.streak} ${p.streak === 1 ? "day" : "days"}`;
  el("bestStreak").textContent = `best: ${p.best_streak}`;
  // The mascot's mood follows my streak: sleepy with no streak, happy while it's
  // alive, excited once I've reached today's goal
  const mood = p.xp_today >= p.daily_goal ? "excited" : p.streak > 0 ? "happy" : "sleepy";
  el("streakMascot").innerHTML = mascot(mood, 40);
  el("levelNumber").textContent = p.level;
  el("toNextLevel").textContent = `${p.level_end - p.xp} XP`;
  el("nextLevelLabel").textContent = `to level ${p.level + 1}`;
}

// LEVEL UP: the mascot jumps up in the middle of the screen for a few seconds
function celebrateLevelUp(level) {
  const overlay = document.createElement("div");
  overlay.className = "level-up";
  overlay.innerHTML = `
    <div class="level-up-box">
      ${mascot("excited", 120)}
      <h2>Level ${level}!</h2>
      <p>Keep talking, you're getting better every day.</p>
    </div>`;
  overlay.onclick = () => overlay.remove(); // click to close early
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3000);
}

// The server gave me XP (for a message, a saved word, a studied card...)
socket.on("xp", p => {
  showProgress(p);
  if (p.level_up) {
    celebrateLevelUp(p.level);
  } else if (!["message", "save_word", "speaking"].includes(p.reason)) {
    // Messages and speaking happen a lot, and saving a word already shows
    // "Saved ... → ...", so those only update the bar
    showToast(`+${p.gained} XP`);
  }
});


// ---------- SPEAKING TIME (the home page "Today" card) ----------
let speaking = { today: 0, week: 0 }; // seconds

async function loadSpeaking() {
  try {
    speaking = await api("/api/speaking");
  } catch {
    // e.g. 11_speaking.sql hasn't been run yet: it stays at 0
  }
  showSpeaking();
}

function showSpeaking() {
  el("speakWeek").textContent = shortMinutes(speaking.week);
  // Today's time (and how it's counted) when I point at it
  el("speakCell").title = `${shortMinutes(speaking.today)} today. Counted while your microphone ` +
    "hears you talking in calls and voice rooms.";
}

// e.g. "0 min", "<1 min", "42 min": short enough to never wrap
function shortMinutes(seconds) {
  if (seconds > 0 && seconds < 60) return "<1 min";
  return `${Math.round(seconds / 60)} min`;
}

// talking.js just sent some seconds to the server: count them here too, without asking again
function addSpokenSeconds(seconds) {
  speaking.today += seconds;
  speaking.week += seconds;
  showSpeaking();
}
