// LIGHT / DARK MODE: light, dark, or "same as my device" (the default).
// The choice is remembered in this browser (localStorage), so each device can have its own.
// A tiny script at the top of index.html applies it before the page is drawn;
// this file draws the buttons and handles clicks. (The dark colors are in base.css.)

const THEME_KEY = "theme";
const darkDevice = matchMedia("(prefers-color-scheme: dark)");

function themeChoice() {
  try {
    return localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system"; // e.g. a private window that blocks storage
  }
}

function applyTheme() {
  const choice = themeChoice();
  const dark = choice === "dark" || (choice === "system" && darkDevice.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // The button shows what clicking it does: a sun in dark mode, a moon in light mode
  document.querySelectorAll(".theme-btn").forEach(button => {
    button.innerHTML = icon(dark ? "sun" : "moon");
    button.title = dark ? "Light mode" : "Dark mode";
  });
  el("profTheme").value = choice;
  // The color of the browser's / installed app's title bar
  document.querySelector('meta[name="theme-color"]').content = dark ? "#191714" : "#fff6e6";
}

function setTheme(choice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // can't remember it: it still changes for now
  }
  applyTheme();
}

// The sun/moon buttons switch between light and dark
document.querySelectorAll(".theme-btn").forEach(button => {
  button.onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
// The Profile page setting (also "Same as my device")
el("profTheme").onchange = () => setTheme(el("profTheme").value);
// "Same as my device": follow it when the device switches (e.g. at sunset)
darkDevice.addEventListener("change", applyTheme);

applyTheme();
