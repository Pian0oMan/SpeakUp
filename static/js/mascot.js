// THE MASCOT: a little flame creature with stick arms and legs.
// He has no mouth: all his feelings show in his EYES and EYEBROWS.
//
//   mascot("happy")             -> an SVG drawing (as text) you can put in the page
//   mascot("excited", 120)      -> the same, 120 pixels wide
//
// Moods: idle, happy, excited, sad, sleepy, surprised, determined, wave
//
// He's drawn with SVG: shapes described with numbers on a 120 x 140 grid.
// (0, 0) is the top-left corner; x goes right, y goes down.

let mascotCount = 0; // each drawing needs its own ids for its colors

// Eyes for each mood. Left eye is around x=50, right eye around x=70, both at y=93.
const MASCOT_EYES = {
  idle: `<ellipse cx="50" cy="93" rx="2.8" ry="4.2"/><ellipse cx="70" cy="93" rx="2.8" ry="4.2"/>`,
  // ^ ^ : happy arcs
  happy: `<path d="M45 95 Q50 88 55 95" class="line"/><path d="M65 95 Q70 88 75 95" class="line"/>`,
  // big eyes with a white shine
  excited: `<ellipse cx="50" cy="92" rx="4" ry="5.5"/><ellipse cx="70" cy="92" rx="4" ry="5.5"/>
            <circle cx="51.5" cy="90" r="1.5" fill="#fff"/><circle cx="71.5" cy="90" r="1.5" fill="#fff"/>`,
  sad: `<ellipse cx="50" cy="95" rx="2.6" ry="3.6"/><ellipse cx="70" cy="95" rx="2.6" ry="3.6"/>`,
  // closed eyes: little downward curves
  sleepy: `<path d="M45 94 Q50 98 55 94" class="line"/><path d="M65 94 Q70 98 75 94" class="line"/>`,
  // round "O" eyes
  surprised: `<circle cx="50" cy="93" r="4.2" fill="none" class="line"/><circle cx="70" cy="93" r="4.2" fill="none" class="line"/>
              <circle cx="50" cy="93" r="1.6"/><circle cx="70" cy="93" r="1.6"/>`,
  determined: `<ellipse cx="50" cy="94" rx="3" ry="3.6"/><ellipse cx="70" cy="94" rx="3" ry="3.6"/>`,
  wave: `<path d="M45 95 Q50 88 55 95" class="line"/><path d="M65 95 Q70 88 75 95" class="line"/>`,
};

// Eyebrows: they change the feeling a lot!
const MASCOT_BROWS = {
  idle: `<path d="M45 83 L54 83"/><path d="M66 83 L75 83"/>`,
  happy: `<path d="M45 83 Q50 80 55 83"/><path d="M65 83 Q70 80 75 83"/>`,
  excited: `<path d="M44 80 Q50 76 55 80"/><path d="M65 80 Q70 76 76 80"/>`,
  // worried: the inner ends go UP
  sad: `<path d="M44 86 L54 82"/><path d="M66 82 L76 86"/>`,
  sleepy: `<path d="M45 87 L54 87"/><path d="M66 87 L75 87"/>`,
  surprised: `<path d="M44 80 Q50 74 56 80"/><path d="M64 80 Q70 74 76 80"/>`,
  // focused: the inner ends go DOWN
  determined: `<path d="M44 82 L55 86"/><path d="M65 86 L76 82"/>`,
  wave: `<path d="M45 83 Q50 80 55 83"/><path d="M65 83 Q70 80 75 83"/>`,
};

// Arms: [left arm, right arm]. Each is a little bent stick (shoulder -> elbow -> hand).
const MASCOT_ARMS = {
  down: [`M28 92 L19 100 L15 108`, `M92 92 L101 100 L105 108`],
  up: [`M28 88 L18 78 L13 66`, `M92 88 L102 78 L107 66`],
  wave: [`M28 92 L19 100 L15 108`, `M92 88 L103 78 L106 64`],
  flex: [`M28 92 L17 92 L16 80`, `M92 92 L103 92 L104 80`],
  droop: [`M29 95 L22 106 L21 114`, `M91 95 L98 106 L99 114`],
};
const ARMS_FOR = {
  idle: "down", happy: "down", excited: "up", sad: "droop", sleepy: "droop",
  surprised: "up", determined: "flex", wave: "wave",
};

function mascot(mood = "idle", size = 80) {
  const id = "mascot" + ++mascotCount;
  const eyes = MASCOT_EYES[mood] || MASCOT_EYES.idle;
  const brows = MASCOT_BROWS[mood] || MASCOT_BROWS.idle;
  const [leftArm, rightArm] = MASCOT_ARMS[ARMS_FOR[mood] || "down"];
  const extra = mood === "sleepy"
    ? `<text x="86" y="40" class="zzz">z</text><text x="94" y="28" class="zzz small">z</text>`
    : "";
  return `
    <svg class="mascot mood-${mood}" viewBox="0 0 120 140" width="${size}" height="${size * 140 / 120}" aria-hidden="true">
      <defs>
        <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffb52e"/>
          <stop offset="1" stop-color="#ff5a1f"/>
        </linearGradient>
        <linearGradient id="${id}-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe08a"/>
          <stop offset="1" stop-color="#ffc24b"/>
        </linearGradient>
      </defs>
      <g class="mascot-legs" stroke="#16131c" stroke-width="3.2" stroke-linecap="round" fill="none">
        <path d="M51 118 L49 133 L44 134"/>
        <path d="M69 118 L71 133 L76 134"/>
      </g>
      <g class="mascot-arms" stroke="#16131c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="${leftArm}"/>
        <path class="${mood === "wave" ? "waving-arm" : ""}" d="${rightArm}"/>
      </g>
      <g class="mascot-body">
        <!-- the flame: a big tip on top and a smaller flick on the left -->
        <path fill="url(#${id}-body)" d="M60 6 C73 30 98 42 96 78 C95 104 79 121 60 121
                 C41 121 24 105 24 80 C24 62 33 52 39 38 C42 51 48 57 54 60 C49 41 52 23 60 6 Z"/>
        <!-- the glowing middle -->
        <path fill="url(#${id}-core)" d="M60 56 C69 69 81 78 80 95 C79 109 70 115 60 115
                 C50 115 40 108 40 95 C40 83 50 75 60 56 Z"/>
        <!-- face: eyes + eyebrows, all black -->
        <g fill="#16131c">${eyes}</g>
        <g stroke="#16131c" stroke-width="2.6" stroke-linecap="round" fill="none">${brows}</g>
      </g>
      ${extra}
    </svg>`;
}
