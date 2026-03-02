/* v2.js — episode engine + full-screen confetti */

let currentSceneIndex = 0;
let episodeData = null;

// Cache DOM
const bgLayer = document.getElementById('bgLayer');

const dialogue = document.getElementById('dialogue');
const dialogueText = document.getElementById('dialogueText');

const emojiTray = document.getElementById('emojiTray');
const emojiSlots = Array.from(document.querySelectorAll('.emoji-slot'));

const micButton = document.getElementById('micButton');
const fxLayer = document.getElementById('fxLayer');

// Confetti assets you already have
const CONFETTI_ASSETS = [
  '/assets/ui/confetti-blue-ribbon.png',
  '/assets/ui/confetti-golden-ribbon.png',
  '/assets/ui/confetti-green-ribbon.png',
  '/assets/ui/confetti-pink-twirl.png',
  '/assets/ui/confetti-star.png',
];

// Load episode JSON
fetch('/lessons/episode-01.json')
  .then(res => {
    if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
    return res.json();
  })
  .then(data => {
    episodeData = data;
    playScene(0);
  })
  .catch(err => console.error(err));

function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.error('Scene not found:', index);
    return;
  }

  const scene = episodeData.scenes[index];

  // Reset UI each scene
  hideEmojiTray();
  hideMic();
  clearFX();

  // Background
  setBackground(scene.background || 'bg-puppies.png');

  // Dialogue lines
  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

/* =========================
   Background
========================= */
function setBackground(bgFile) {
  // allow passing full filename or just "bg-puppies.png"
  const path = bgFile.startsWith('/assets/')
    ? bgFile
    : `/assets/backgrounds/${bgFile}`;

  bgLayer.style.backgroundImage = `url("${path}")`;
}

/* =========================
   Dialogue
========================= */
function playDialogue(lines, done) {
  if (!lines || lines.length === 0) {
    hideDialogue();
    done?.();
    return;
  }

  showDialogue();
  let i = 0;

  const advance = () => {
    if (i >= lines.length) {
      // short beat before interaction shows
      setTimeout(() => done?.(), 250);
      return;
    }

    dialogueText.textContent = lines[i];
    i += 1;

    // Auto-advance timing: tweak as needed
    setTimeout(advance, 1400);
  };

  advance();
}

function showDialogue() {
  dialogue.classList.add('active');
}
function hideDialogue() {
  dialogue.classList.remove('active');
}

/* =========================
   Interaction routing
========================= */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    // auto-advance
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  if (interaction.type === 'emoji') {
    showEmojiTray(interaction);
    return;
  }

  if (interaction.type === 'mic') {
    showMic(interaction);
    return;
  }

  // fallback
  setTimeout(() => playScene(currentSceneIndex + 1), 700);
}

/* =========================
   Emoji Tray
========================= */
function showEmojiTray(interaction) {
  emojiTray.classList.add('active');
  emojiTray.setAttribute('aria-hidden', 'false');

  const choices = interaction.choices || ['🙇‍♀️', '👋', '🏃‍♀️'];
  const correctIndex = typeof interaction.correctIndex === 'number' ? interaction.correctIndex : 0;

  // Fill slots
  emojiSlots.forEach((btn, idx) => {
    btn.textContent = choices[idx] ?? '';
    btn.disabled = false;

    // clear old listeners (safe pattern)
    btn.onclick = null;
    btn.onclick = () => handleEmojiPick(idx, correctIndex, interaction);
  });
}

function hideEmojiTray() {
  emojiTray.classList.remove('active');
  emojiTray.setAttribute('aria-hidden', 'true');
  emojiSlots.forEach(btn => {
    btn.onclick = null;
    btn.disabled = true;
    btn.textContent = '';
  });
}

function handleEmojiPick(pickedIdx, correctIdx, interaction) {
  // lock
  emojiSlots.forEach(b => (b.disabled = true));

  if (pickedIdx === correctIdx) {
    // ✅ success feedback
    playConfettiFullScreen();

    // If you want to also change dialogue line on success:
    const praise = interaction.praise || 'Yes! Great job!';
    showDialogue();
    dialogueText.textContent = praise;

    // Give kids time to see confetti + hear praise
    setTimeout(() => {
      hideEmojiTray();
      playScene(currentSceneIndex + 1);
    }, 1600);

  } else {
    // ❌ gentle retry
    const retry = interaction.retry || 'Nice try! Let’s try again.';
    showDialogue();
    dialogueText.textContent = retry;

    setTimeout(() => {
      // re-enable for retry
      emojiSlots.forEach(b => (b.disabled = false));
    }, 600);
  }
}

/* =========================
   Mic
========================= */
function showMic(interaction) {
  micButton.classList.remove('hidden');

  micButton.onclick = null;
  micButton.onclick = () => {
    micButton.classList.add('hidden');
    micButton.onclick = null;
    // advance
    setTimeout(() => playScene(currentSceneIndex + 1), 250);
  };
}

function hideMic() {
  micButton.classList.add('hidden');
  micButton.onclick = null;
}

/* =========================
   Full-screen confetti
========================= */
function playConfettiFullScreen() {
  // Create a burst container that covers the whole viewport
  const burst = document.createElement('div');
  burst.className = 'confetti-burst';

  // number of pieces
  const N = 28;

  for (let i = 0; i < N; i++) {
    const img = document.createElement('img');
    img.className = 'confetti-piece';
    img.alt = '';

    // random asset
    const src = CONFETTI_ASSETS[Math.floor(Math.random() * CONFETTI_ASSETS.length)];
    img.src = src;

    // spread across entire width
    const x = Math.random() * 100;

    // random size
    const size = 28 + Math.random() * 34; // 28..62 px

    // random delay so it feels alive (still short)
    const delay = Math.random() * 250; // 0..250ms

    // slower duration
    const dur = 1700 + Math.random() * 600; // 1700..2300ms

    img.style.left = `${x}%`;
    img.style.setProperty('--size', `${size}px`);
    img.style.setProperty('--delay', `${Math.round(delay)}ms`);
    img.style.setProperty('--dur', `${Math.round(dur)}ms`);

    burst.appendChild(img);
  }

  fxLayer.appendChild(burst);

  // remove after max duration
  setTimeout(() => {
    burst.remove();
  }, 2600);
}

function clearFX() {
  fxLayer.innerHTML = '';
}

/* =========================
   Optional: click to advance (debug helper)
   Uncomment if you want tap-to-skip while testing
========================= */
// document.getElementById('viewport').addEventListener('click', (e) => {
//   // avoid clicking on emoji buttons/mic
//   if (e.target.closest('.emoji-tray') || e.target.closest('.mic')) return;
//   playScene(currentSceneIndex + 1);
// });
