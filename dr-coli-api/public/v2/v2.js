// v2.js
// Episode engine — Phase 3: dialogue + emoji tray + mic placeholder + full-screen confetti

let currentSceneIndex = 0;
let episodeData = null;

// ---------- BOOT ----------
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

// ---------- SCENE ENGINE ----------
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

// ---------- UI: Dialogue ----------
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

    // Placeholder timing (later: audio duration)
    setTimeout(next, 1200);
  };

  next();
}

// ---------- UI: Emoji Interaction ----------
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

// ---------- UI: Mic Interaction (placeholder) ----------
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

// ---------- FX: Confetti (FULL SCREEN) ----------
function confettiBurstFullScreen() {
  const fx = document.getElementById('fxLayer');
  const viewport = document.getElementById('viewport');
  if (!fx || !viewport) return;

  const confettiFiles = [
    '/assets/ui/confetti-star.png',
    '/assets/ui/confetti-blue-ribbon.png',
    '/assets/ui/confetti-golden-ribbon.png',
    '/assets/ui/confetti-green-ribbon.png',
    '/assets/ui/confetti-pink-twirl.png'
  ];

  const rect = viewport.getBoundingClientRect();
  const count = 34; // more pieces for full-screen burst

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = confettiFiles[i % confettiFiles.length];

    // Spawn across full width, slightly above top
    const startX = Math.random() * rect.width;
    const startY = -40 - Math.random() * 120;

    const size = 18 + Math.random() * 34;
    img.style.position = 'absolute';
    img.style.left = `${startX}px`;
    img.style.top = `${startY}px`;
    img.style.width = `${size}px`;
    img.style.height = 'auto';
    img.style.opacity = '0.95';
    img.style.pointerEvents = 'none';

    // Motion: drift sideways + fall down
    const driftX = (Math.random() - 0.5) * 260;
    const endY = rect.height + 120 + Math.random() * 180;

    const rot0 = Math.random() * 360;
    const rot1 = rot0 + (Math.random() - 0.5) * 1080;

    fx.appendChild(img);

    img.animate(
      [
        { transform: `translate(0px, 0px) rotate(${rot0}deg)`, opacity: 1 },
        { transform: `translate(${driftX}px, ${endY * 0.55}px) rotate(${rot1 * 0.7}deg)`, opacity: 1 },
        { transform: `translate(${driftX * 1.2}px, ${endY}px) rotate(${rot1}deg)`, opacity: 0 }
      ],
      {
        duration: 1400 + Math.random() * 700,
        easing: 'cubic-bezier(.2,.8,.2,1)'
      }
    );

    setTimeout(() => img.remove(), 2400);
  }
}

// ---------- Helpers ----------
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

// Placeholder stubs (sprite engine comes later)
function setDrColi(state) {}
function setBori(state) {}
