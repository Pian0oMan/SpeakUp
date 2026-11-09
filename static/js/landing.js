// LANDING PAGE: the flashcard demo ("Words from your chats become words you know").
// A pretend study session with 4 cards from the chat at the top of the page.
// Click the card to flip it, then "Know it" or "Don't know", like in the real study mode.
// The rings are drawn with makeRing / setRing from decks.js, so they look exactly the same.

const DEMO_CARDS = [
  { word: "公園", reading: "こうえん", meaning: "park", example: "公園のベンチで読むの？", p: 51 },
  { word: "週末", reading: "しゅうまつ", meaning: "weekend", example: "週末は何をしているの？", p: 17 },
  { word: "美味しい", reading: "おいしい", meaning: "delicious", example: "このラーメン、美味しい！", p: 84 },
  { word: "友達", reading: "ともだち", meaning: "friend", example: "友達になろう！", p: 33 },
];
let demoIndex = 0;
let demoBusy = false; // true while the next card is coming in (so double clicks don't skip cards)

// The small deck list next to the card: one row per word, with its ring
const demoRows = DEMO_CARDS.map(card => {
  const row = document.createElement("li");
  const ring = makeRing(card.p);
  const word = document.createElement("strong");
  word.textContent = card.word;
  const meaning = document.createElement("span");
  meaning.textContent = card.meaning;
  row.append(ring, word, meaning);
  el("demoDeckList").appendChild(row);
  return { row, ring };
});

function showDemoCard() {
  const card = DEMO_CARDS[demoIndex];
  el("demoCard").classList.remove("flipped");
  el("demoWord").textContent = card.word;
  el("demoReading").textContent = card.reading;
  el("demoMeaning").textContent = card.meaning;
  el("demoExample").textContent = card.example;
  setRing(el("demoRing"), card.p);
  demoRows.forEach(({ row }, i) => row.classList.toggle("current", i === demoIndex));
}

el("demoCard").onclick = () => el("demoCard").classList.toggle("flipped");

// "Know it": the ring fills up. "Don't know": it starts over (and the card comes back soon).
function gradeDemo(knewIt) {
  if (demoBusy) return;
  demoBusy = true;
  const card = DEMO_CARDS[demoIndex];
  el("demoCard").classList.add("flipped"); // show the answer, if it wasn't showing yet
  card.p = knewIt ? Math.min(100, card.p + 22) : 0;
  setRing(el("demoRing"), card.p);
  setRing(demoRows[demoIndex].ring, card.p);
  popDemoXp(knewIt ? "+3 XP" : "+1 XP");
  setTimeout(() => {
    demoIndex = (demoIndex + 1) % DEMO_CARDS.length;
    showDemoCard();
    demoBusy = false;
  }, 900);
}
el("demoKnow").onclick = () => gradeDemo(true);
el("demoDontKnow").onclick = () => gradeDemo(false);

// The "+3 XP" sticker that pops up and floats away
function popDemoXp(text) {
  const xp = el("demoXp");
  xp.textContent = text;
  xp.classList.remove("pop");
  void xp.offsetWidth; // restart the animation, even if it's still running
  xp.classList.add("pop");
}

showDemoCard();
