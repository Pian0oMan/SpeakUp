// WELCOME QUESTIONS: right after signing up, the mascot asks a few questions,
// one per screen (like Duolingo). The answers are saved to the profile at the end,
// and used to match people with similar interests and levels.

let onboardSteps = [];  // e.g. ["languages", "country", "fluency", ...]
let onboardIndex = 0;   // which step we're on
let answers = {};       // what they picked so far

// For each step: the mascot's mood, and the question it asks
const STEP_INFO = {
  name: { mood: "wave", ask: () => "Hi, I'm your Speak Up buddy! What should people call you?" },
  languages: { mood: "happy", ask: () => "Which language do you speak, and which one do you want to learn?" },
  country: { mood: "idle", ask: () => "Where are you from?" },
  fluency: { mood: "determined", ask: () => `How well do you speak ${answers.learning}?` },
  studying_for: { mood: "idle", ask: () => `How long have you been learning ${answers.learning}?` },
  interests: { mood: "excited", ask: () => "What are you into? We'll help you meet people who like the same things." },
  done: { mood: "excited", ask: () => `You're all set, ${answers.username}!` },
};
const MIN_INTERESTS = 3;

async function startOnboarding() {
  // Start from what we already know: an existing profile, or the name from the sign-up form
  const user = (await sb.auth.getUser()).data.user;
  answers = {
    username: (profile && profile.username) || (user && user.user_metadata.username) || "",
    native: (profile && profile.native) || "English",
    learning: (profile && profile.learning) || "Spanish",
    country: (profile && profile.country) || "",
    fluency: (profile && profile.fluency) || null,
    studying_for: (profile && profile.studying_for) || null,
    interests: (profile && profile.interests) || [],
  };
  // Only ask for a name if we don't have one yet
  onboardSteps = [...(answers.username ? [] : ["name"]), "languages", "country", "fluency", "studying_for", "interests", "done"];
  onboardIndex = 0;

  el("obName").value = answers.username;
  el("obNative").value = answers.native;
  el("obLearning").value = answers.learning;
  blockSameLanguage(["obNative", "obLearning"]);
  el("obCountry").value = answers.country;
  fillInterestPicker(el("obInterests"), answers.interests, updateOnboardButton);
  showScreen("onboardScreen");
  showOnboardStep();
}

function showOnboardStep() {
  const step = onboardSteps[onboardIndex];
  document.querySelectorAll(".ob-step").forEach(div => (div.hidden = div.dataset.step !== step));
  el("obMascot").innerHTML = mascot(STEP_INFO[step].mood, 110);
  el("obQuestion").textContent = STEP_INFO[step].ask();

  // Progress bar + "3 / 6" (the "done" screen isn't a question, so it's not counted)
  const questions = onboardSteps.length - 1;
  el("obProgress").style.width = `${(onboardIndex / questions) * 100}%`;
  el("obCount").textContent = step === "done" ? "" : `${onboardIndex + 1} / ${questions}`;
  el("obBack").style.visibility = onboardIndex === 0 || step === "done" ? "hidden" : "visible";

  // Highlight the answer card I picked (if this step has cards)
  document.querySelectorAll(`.ob-step[data-step="${step}"] .ob-option`).forEach(option => {
    option.classList.toggle("on", option.dataset.value === answers[step]);
  });

  if (step === "done") {
    const parts = [`Learning ${answers.learning}`];
    if (answers.fluency) parts.push(FLUENCY_LABELS[answers.fluency]);
    el("obSummary").textContent =
      `${parts.join(" · ")}. Into ${interestList(answers.interests)}. Let's find you someone to talk to!`;
  }
  updateOnboardButton();
  if (step === "name") el("obName").focus();
}

// Is this step answered? (Continue only works once it is)
function stepAnswered(step) {
  if (step === "name") return el("obName").value.trim().length > 0;
  if (step === "languages") return el("obNative").value !== el("obLearning").value;
  if (step === "fluency" || step === "studying_for") return Boolean(answers[step]);
  if (step === "interests") return pickedInterests(el("obInterests")).length >= MIN_INTERESTS;
  return true; // country is optional, "done" is always fine
}

function updateOnboardButton() {
  const step = onboardSteps[onboardIndex];
  el("obNext").disabled = !stepAnswered(step);
  el("obNext").textContent =
    step === "done" ? "Let's go!" : step === "country" && !el("obCountry").value ? "Skip" : "Continue";
  if (step === "interests") {
    const count = pickedInterests(el("obInterests")).length;
    el("obInterestCount").textContent = count >= MIN_INTERESTS
      ? `${count} picked (up to ${MAX_INTERESTS})`
      : `Pick ${MIN_INTERESTS - count} more`;
  }
}

// Remember what's on the screen before moving on
function saveStepAnswer(step) {
  if (step === "name") answers.username = el("obName").value.trim();
  if (step === "languages") {
    answers.native = el("obNative").value;
    answers.learning = el("obLearning").value;
  }
  if (step === "country") answers.country = el("obCountry").value;
  if (step === "interests") answers.interests = pickedInterests(el("obInterests"));
}

// Clicking an answer card picks it
document.querySelectorAll(".ob-option").forEach(option => {
  option.onclick = () => {
    answers[option.closest(".ob-step").dataset.step] = option.dataset.value;
    showOnboardStep();
  };
});
el("obName").oninput = updateOnboardButton;
el("obName").onkeydown = event => {
  if (event.key === "Enter" && !el("obNext").disabled) el("obNext").click();
};
["obNative", "obLearning", "obCountry"].forEach(id => el(id).addEventListener("change", updateOnboardButton));

el("obBack").onclick = () => {
  saveStepAnswer(onboardSteps[onboardIndex]);
  onboardIndex--;
  showOnboardStep();
};

el("obNext").onclick = () => {
  const step = onboardSteps[onboardIndex];
  if (!stepAnswered(step)) return;
  saveStepAnswer(step);
  if (step === "done") return finishOnboarding();
  onboardIndex++;
  showOnboardStep();
};

// Save everything, then go into the app
async function finishOnboarding() {
  el("obNext").disabled = true;
  await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      ...answers,
      // Translations are shown in the language I speak (can be changed on the Profile page)
      translate_to: (profile && profile.translate_to) || answers.native,
    }),
  });
  enterApp();
}

el("obLogout").onclick = () => el("logoutBtn").click();
