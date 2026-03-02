// v2.js

let currentSceneIndex = 0;
let episodeData = null;

document.addEventListener('DOMContentLoaded', () => {
  setBackground('bg-puppies.png');

  fetch('/lessons/episode-01.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      episodeData = data;
      if (episodeData.background) setBackground(episodeData.background);
      playScene(0);
    })
    .catch((err) => console.error(err));
});

function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData?.scenes?.[index]) {
    console.warn('No more scenes or scene not found:', index);
    hideAllUI();
    return;
  }

  hideAllUI();

  const scene = episodeData.scenes[index];

  if (scene.background) setBackground(scene.background);
  else if (episodeData.background) setBackground(episodeData.background);

  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  if (interaction.type === 'emoji') {
    runEmojiInteraction(interaction);
    return;
  }

  if (interaction.type === 'mic') {
    runMicInteraction(interaction);
    return;
  }

  console.log('Unknown interaction:', interaction);
  setTimeout(() => playScene(currentSceneIndex + 1), 700);
}

/* ---------- Dialogue ---------- */
function playDialogue(lines, onDone) {
  const dialogueEl = document.getElementById('dialogue');
  const textEl = document.getElementById('dialogueText');

  if (!dialogueEl || !textEl) {
    console.warn('Dialogue UI missing (#dialogue / #dialogueText).');
    onDone?.();
    return;
  }

  if (!lines.length) {
    dialogueEl.classList.remove('active');
    onDone?.();
    return;
  }

  dialogueEl.classList.add('active');

  let i = 0;
  const next = () => {
    if (i >= lines.length) {
      setTimeout(() => {
        dialogueEl.classList.remove('active');
        onDone?.();
      }, 250);
      return;
    }

    textEl.textContent = lines[i];
    i += 1;

    // Placeholder timing (later: audio length)
    setTimeout(next, 1200);
  };

  next();
}

/* ---------- Emoji Interaction ---------- */
function runEmojiInteraction(interaction) {
  const tray = document.getElementById('emojiTray');
  const slots = Array.from(document.querySelectorAll('.emoji-slot'));

  if (!tray || slots.length !== 3) {
    console.warn('Emoji tray UI missing');
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  const choices = interaction.choices || ['🙂', '🙂', '🙂'];
  slots.forEach((btn, idx) => {
    btn.textContent = choices[idx] || '';
    btn.disabled = false;
    btn.onclick = null;
  });

  tray.classList.remove('hidden');
  tray.classList.add('active');
  tray.setAttribute('aria-hidden', 'false');

  const correctIndex = Number(interaction.correctIndex ?? 0);

  const lockButtons = () => slots.forEach((b) => (b.disabled = true));
  const unlockButtons = () => slots.forEach((b) => (b.disabled = false));

  slots.forEach((btn, idx) => {
    btn.onclick = () => {
      lockButtons();

      if (idx === correctIndex) {
        confettiBurstFullScreen();

        const lines = interaction.onCorrectSay || ['Great job!'];
        playDialogue(lines, () => {
          hideEmojiTray();
          setTimeout(() => playScene(currentSceneIndex + 1), 600);
        });
      } else {
        const lines = interaction.onWrongSay || ['Nice try! Let’s try again.'];
        playDialogue(lines, () => {
          unlockButtons();
        });
      }
    };
  });
}

function hideEmojiTray() {
  const tray = document.getElementById('emojiTray');
  if (!tray) return;

  tray.classList.remove('active');
  tray.setAttribute('aria-hidden', 'true');
  setTimeout(() => tray.classList.add('hidden'), 250);
}

/* ---------- Mic Interaction (placeholder) ---------- */
function runMicInteraction(interaction) {
  const mic = document.getElementById('micButton');
  if (!mic) {
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  mic.classList.remove('hidden');

  if (interaction.prompt) {
    playDialogue([interaction.prompt], () => {});
  }

  mic.onclick = () => {
    mic.classList.add('hidden');
    mic.onclick = null;
    setTimeout(() => playScene(currentSceneIndex + 1), 400);
  };
}

/* ---------- Confetti (FULL SCREEN + SLOWER) ---------- */
function confettiBurstFullScreen() {
  const fx = document.getElementById('fxLayer');
  const viewport = document.getElementById('viewport');
  if (!fx || !viewport) return;

  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  const confettiFiles = [
    '/assets/ui/confetti-star.png',
    '/assets/ui/confetti-blue-ribbon.png',
    '/assets/ui/confetti-golden-ribbon.png',
    '/assets/ui/confetti-green-ribbon.png',
    '/assets/ui/confetti-pink-twirl.png'
  ];

  const count = 48; // more = more “celebration”

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = confettiFiles[i % confettiFiles.length];

    const startX = Math.random() * w;
    const startY = -60 - Math.random() * 160;

    const size = 20 + Math.random() * 38;
    img.style.position = 'absolute';
    img.style.left = `${startX}px`;
    img.style.top = `${startY}px`;
    img.style.width = `${size}px`;
    img.style.height = 'auto';
    img.style.opacity = '1';
    img.style.pointerEvents = 'none';

    fx.appendChild(img);

    const driftX = (Math.random() - 0.5) * 320;
    const endY = h + 160 + Math.random() * 220;

    const rot0 = Math.random() * 360;
    const rot1 = rot0 + (Math.random() - 0.5) * 1400;

    const dur = 2400 + Math.random() * 800; // 2.4–3.2s

    img.animate(
      [
        { transform: `translate(0px, 0px) rotate(${rot0}deg)`, opacity: 1 },
        { transform: `translate(${driftX}px, ${endY * 0.65}px) rotate(${rot1 * 0.7}deg)`, opacity: 1 },
        { transform: `translate(${driftX * 1.15}px, ${endY}px) rotate(${rot1}deg)`, opacity: 0 }
      ],
      {
        duration: dur,
        easing: 'cubic-bezier(.15,.85,.25,1)',
        fill: 'forwards'
      }
    );

    setTimeout(() => img.remove(), dur + 200);
  }
}

/* ---------- Helpers ---------- */
function hideAllUI() {
  const tray = document.getElementById('emojiTray');
  if (tray) {
    tray.classList.remove('active');
    tray.classList.add('hidden');
    tray.setAttribute('aria-hidden', 'true');
  }

  const mic = document.getElementById('micButton');
  if (mic) {
    mic.classList.add('hidden');
    mic.onclick = null;
  }
}

function setBackground(filename) {
  const bgLayer = document.getElementById('bgLayer');
  if (!bgLayer) return;
  bgLayer.style.backgroundImage = `url("/assets/backgrounds/${filename}")`;
}

// Sprite engine hooks (stubs for now)
function setDrColi(state) {}
function setBori(state) {}
