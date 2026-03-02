/* v2.js — episode engine + CONFETTI FIXED (top → bottom, smaller, longer) */

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

// Confetti assets
const CONFETTI_ASSETS = [
  '/assets/ui/confetti-blue-ribbon.png',
  '/assets/ui/confetti-golden-ribbon.png',
  '/assets/ui/confetti-green-ribbon.png',
  '/assets/ui/confetti-pink-twirl.png',
  '/assets/ui/confetti-star.png',
];

// Load episode
fetch('/lessons/episode-01.json')
  .then(res => res.json())
  .then(data => {
    episodeData = data;
    playScene(0);
  });

function playScene(index) {
  currentSceneIndex = index;
  if (!episodeData?.scenes?.[index]) return;

  const scene = episodeData.scenes[index];

  hideEmojiTray();
  hideMic();
  clearFX();

  setBackground(scene.background || 'bg-puppies.png');

  playDialogue(scene.drColi?.say || [], () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

/* ================= Background ================= */
function setBackground(bgFile) {
  bgLayer.style.backgroundImage =
    `url("/assets/backgrounds/${bgFile}")`;
}

/* ================= Dialogue ================= */
function playDialogue(lines, done) {
  if (!lines.length) {
    hideDialogue();
    done?.();
    return;
  }

  showDialogue();
  let i = 0;

  const advance = () => {
    if (i >= lines.length) {
      setTimeout(done, 300);
      return;
    }
    dialogueText.textContent = lines[i++];
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

/* ================= Interaction ================= */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }
  if (interaction.type === 'emoji') return showEmojiTray(interaction);
  if (interaction.type === 'mic') return showMic();
}

/* ================= Emoji ================= */
function showEmojiTray(interaction) {
  emojiTray.classList.add('active');

  const choices = interaction.choices || [];
  const correct = interaction.correctIndex ?? 0;

  emojiSlots.forEach((btn, i) => {
    btn.textContent = choices[i] || '';
    btn.disabled = false;
    btn.onclick = () => handleEmojiPick(i, correct, interaction);
  });
}

function hideEmojiTray() {
  emojiTray.classList.remove('active');
  emojiSlots.forEach(b => {
    b.disabled = true;
    b.textContent = '';
    b.onclick = null;
  });
}

function handleEmojiPick(idx, correctIdx, interaction) {
  emojiSlots.forEach(b => (b.disabled = true));

  if (idx === correctIdx) {
    playConfettiTopToBottom();

    dialogueText.textContent =
      interaction.praise || 'Yes! Great job!';
    showDialogue();

    setTimeout(() => playScene(currentSceneIndex + 1), 2400);
  } else {
    dialogueText.textContent =
      interaction.retry || 'Nice try! Let’s try again.';
    showDialogue();

    setTimeout(() => {
      emojiSlots.forEach(b => (b.disabled = false));
    }, 700);
  }
}

/* ================= Mic ================= */
function showMic() {
  micButton.classList.remove('hidden');
  micButton.onclick = () => {
    micButton.classList.add('hidden');
    playScene(currentSceneIndex + 1);
  };
}

function hideMic() {
  micButton.classList.add('hidden');
  micButton.onclick = null;
}

/* ================= CONFETTI (FIXED) ================= */
function playConfettiTopToBottom() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  const COUNT = 36;
  const MIN_DUR = 4200;
  const MAX_DUR = 6000;
  const SCALE = 0.35; // 👈 35% size

  for (let i = 0; i < COUNT; i++) {
    const img = document.createElement('img');
    img.className = 'confetti-piece';
    img.src = CONFETTI_ASSETS[Math.floor(Math.random() * CONFETTI_ASSETS.length)];

    const baseSize = 60 + Math.random() * 40;
    const size = baseSize * SCALE;

    const startX = Math.random() * w;
    const startY = -size - Math.random() * 150;
    const endY = h + size + 120;
    const driftX = (Math.random() - 0.5) * 240;

    const rotStart = Math.random() * 360;
    const rotEnd = rotStart + (Math.random() - 0.5) * 1200;

    const duration = MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR);

    img.style.width = `${size}px`;
    img.style.left = `${startX}px`;
    img.style.top = `${startY}px`;

    fxLayer.appendChild(img);

    const anim = img.animate(
      [
        { transform: `translate(0, 0) rotate(${rotStart}deg)`, opacity: 1 },
        { transform: `translate(${driftX}px, ${endY}px) rotate(${rotEnd}deg)`, opacity: 1 },
      ],
      {
        duration,
        easing: 'linear',
        fill: 'forwards',
      }
    );

    anim.onfinish = () => img.remove();
  }
}

function clearFX() {
  fxLayer.innerHTML = '';
}
