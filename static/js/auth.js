// LANDING PAGE + LOG IN + CREATE ACCOUNT (Supabase).

// ---------- LOG IN + CREATE ACCOUNT (Supabase) ----------
async function start() {
  const config = await (await fetch("/api/config")).json();
  sb = supabase.createClient(config.url, config.anonKey);

  // Runs whenever login state changes: page load, log in, log out, token refresh
  sb.auth.onAuthStateChange((event, session) => {
    token = session ? session.access_token : null;
    if (session && !loggedIn && !registering) {
      enterApp();
    } else if (!session) {
      loggedIn = false;
      showScreen("landingScreen"); // visitors start on the landing page
    }
  });
}

// LANDING PAGE buttons (there are several of each, so we use classes instead of ids)
document.querySelectorAll(".to-login").forEach(button => (button.onclick = () => showScreen("loginScreen")));
document.querySelectorAll(".to-register").forEach(button => (button.onclick = () => showScreen("registerScreen")));
document.querySelectorAll(".to-landing").forEach(link => {
  link.onclick = event => {
    event.preventDefault();
    showScreen("landingScreen");
  };
});
el("howItWorksBtn").onclick = () => el("howItWorks").scrollIntoView({ behavior: "smooth" });

// The scrolling belt of "hello" in many languages.
// It holds the list TWICE in a row and slides left by exactly one list, then starts
// over: because the second copy is identical, the jump back is invisible. One copy
// must be wider than the screen, or there's an empty gap: that's why the list is long.
const GREETINGS = [
  "Hello", "こんにちは", "Hola", "Bonjour", "Hallo", "你好", "Привет", "Ciao", "Olá", "안녕하세요",
  "Merhaba", "Hej", "नमस्ते", "مرحبا", "שלום", "Γειά σου", "Xin chào", "สวัสดี", "Halo", "Jambo",
  "Cześć", "Ahoj", "Szia", "Kia ora", "Aloha", "Sawubona", "Hei", "Dia dhuit", "Salut", "Mabuhay",
];
[...GREETINGS, ...GREETINGS].forEach(word => {
  const span = document.createElement("span");
  span.textContent = word;
  el("marqueeTrack").appendChild(span);
});

el("toRegister").onclick = event => {
  event.preventDefault(); // it's a link: don't jump to "#"
  showScreen("registerScreen");
};
el("toLogin").onclick = event => {
  event.preventDefault();
  showScreen("loginScreen");
};

el("loginForm").onsubmit = async event => {
  event.preventDefault();
  el("loginStatus").textContent = "Logging in...";
  const { error } = await sb.auth.signInWithPassword({
    email: el("loginEmail").value,
    password: el("loginPassword").value,
  });
  el("loginStatus").textContent = error ? error.message : "";
};

// Create account: just name, email and password. The welcome questions come next.
el("registerForm").onsubmit = async event => {
  event.preventDefault();
  const status = el("registerStatus");
  if (el("regPassword").value !== el("regConfirm").value) {
    status.textContent = "The passwords don't match.";
    return;
  }

  status.textContent = "Creating your account...";
  registering = true;
  const { data, error } = await sb.auth.signUp({
    email: el("regEmail").value,
    password: el("regPassword").value,
    // Remember the name with the account, so the welcome questions can use it
    // (even if they first have to confirm their email and log in later)
    options: { data: { username: el("regName").value.trim() } },
  });
  if (error || !data.session) {
    registering = false;
    status.textContent = error ? error.message : "Check your email to confirm your account, then log in.";
    return;
  }
  token = data.session.access_token;
  registering = false;
  status.textContent = "";
  enterApp(); // no profile yet, so this starts the welcome questions
};

el("logoutBtn").onclick = () => {
  if (currentRoom) leaveRoom();
  leaveChat();
  sb.auth.signOut();
};
