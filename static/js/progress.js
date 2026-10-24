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
  el("goalText").textContent = `${p.xp_today} / ${p.daily_goal} XP`;
  el("todayStreak").textContent = `${p.streak} ${p.streak === 1 ? "day" : "days"} streak`;
  // The mascot's mood follows my streak: sleepy with no streak, happy while it's
  // alive, excited once I've reached today's goal
  const mood = p.xp_today >= p.daily_goal ? "excited" : p.streak > 0 ? "happy" : "sleepy";
  el("streakMascot").innerHTML = mascot(mood, 52);
  el("bestStreak").textContent = `Best: ${p.best_streak}`;
  el("todayLevel").textContent = `Level ${p.level}`;
  el("toNextLevel").textContent = `${p.level_end - p.xp} XP to level ${p.level + 1}`;
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
  } else if (p.reason !== "message" && p.reason !== "save_word") {
    // Messages happen a lot, and saving a word already shows "Saved ... → ...",
    // so those two only update the bar
    showToast(`+${p.gained} XP`);
  }
});
