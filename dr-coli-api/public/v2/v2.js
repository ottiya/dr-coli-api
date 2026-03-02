/* v2.js — episode engine + full-screen confetti (top->bottom, long, remove at bottom) */

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
const viewport = document.getElementById('viewport');

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
      setTimeout(() => done?.(), 250);
      return;
    }

    dialogueText.textContent = lines[i];
    i += 1;

    // Auto-advance timing (later tie to audio)
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

  emojiSlots.forEach((btn, idx) => {
    btn.textContent = choices[idx] ?? '';
    btn.disabled = false;
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
  emojiSlots.forEach(b => (b.disabled = true));

  if (pickedIdx === correctIdx) {
    // ✅ Full-screen confetti (top->bottom, long)
    playConfettiTopToBottom();

    const praise = interaction.praise || 'Yes! Great job!';
    showDialogue();
    dialogueText.textContent = praise;

    // Let kids actually SEE the celebration
    setTimeout(() => {
      hideEmojiTray();
      playScene(currentSceneIndex + 1);
    }, 2200);

  } else {
    const retry = interaction.retry || 'Nice try! Let’s try again.';
    showDialogue();
    dialogueText.textContent = retry;

    setTimeout(() => {
      emojiSlots.forEach(b => (b.disabled = false));
    }, 650);
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
    setTimeout(() => playScene(currentSceneIndex + 1), 250);
  };
}

function hideMic() {
  micButton.classList.add('hidden');
  micButton.onclick = null;
}

/* =========================
   Confetti: TOP -> BOTTOM, long, remove at bottom
========================= */
function playConfettiTopToBottom() {
  if (!fxLayer || !viewport) return;

  // Use the real viewport dimensions (not the window)
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  const pieceCount = 42;          // more pieces, full-screen feel
  const minDur = 4200;            // 4.2s
  const maxDur = 6200;            // 6.2s

  for (let i = 0; i < pieceCount; i++) {
    const img = document.createElement('img');
    img.className = 'confetti-piece';
    img.alt = '';

    img.src = CONFETTI_ASSETS[Math.floor(Math.random() * CONFETTI_ASSETS.length)];

    const size = 22 + Math.random() * 40;        // 22..62px
    const startX = Math.random() * w;            // anywhere across width
    const startY = - (60 + Math.random() * 180); // above the top edge
    const endY = h + 200;                        // past bottom edge
    const driftX = (Math.random() - 0.5) * 280;  // sideways drift

    const rot0 = Math.random() * 360;
    const rot1 = rot0 + (Math.random() - 0.5) * 1400;

    const dur = minDur + Math.random() * (maxDur - minDur);
    const delay = Math.random() * 250;           // tiny stagger

    img.style.width = `${size}px`;
    img.style.left = `${startX}px`;
    img.style.top = `${startY}px`;
    img.style.opacity = '1';

    fxLayer.appendChild(img);

    // Animate with Web Animations API so we can remove exactly at bottom
    const anim = img.animate(
      [
        { transform: `translate(0px, 0px) rotate(${rot0}deg)`, opacity: 1 },
        { transform: `translate(${driftX}px, ${endY * 0.85}px) rotate(${rot1 * 0.7}deg)`, opacity: 1 },
        // Fade only at the very end (so it stays visible)
        { transform: `translate(${driftX * 1.2}px, ${endY}px) rotate(${rot1}deg)`, opacity: 0 }
      ],
      {
        duration: dur,
        delay,
        easing: 'linear',
        fill: 'forwards'
      }
    );

    anim.onfinish = () => {
      img.remove();
    };
  }
}

function clearFX() {
  fxLayer.innerHTML = '';
}
