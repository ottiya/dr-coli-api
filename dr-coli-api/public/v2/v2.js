// v2.js
// Episode engine — Phase 3: dialogue + emoji tray + mic placeholder + confetti

let currentSceneIndex = 0;
let episodeData = null;

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
  // Default background immediately
  setBackground('bg-puppies.png');

  fetch('/lessons/episode-01.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      episodeData = data;

      // Episode-level default background (overrides our hard default if provided)
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

  // Background
  if (scene.background) setBackground(scene.background);
  else if (episodeData.background) setBackground(episodeData.background);

  // Character states (placeholders until sprite engine is wired)
  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  // Dialogue lines
  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    // Auto-advance
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
    setTimeout(next, 1200); // placeholder timing; later tie to audio duration
  };

  next();
}

// ---------- UI: Emoji Interaction ----------
function runEmojiInteraction(interaction) {
  const tray = document.getElementById('emojiTray');
  const slots = Array.from(document.querySelectorAll('.emoji-slot'));

  if (!tray || slots.length !== 3) {
    console.warn('Emoji tray UI missing');
    // fallback: just advance
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  // Fill emoji choices
  const choices = interaction.choices || ['🙂', '🙂', '🙂'];
  slots.forEach((btn, idx) => {
    btn.textContent = choices[idx] || '';
    btn.disabled = false;
    btn.onclick = null;
  });

  // Show tray
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
        // ✅ Correct
        confettiBurst();

        const lines = interaction.onCorrectSay || ['Great job!'];
        playDialogue(lines, () => {
          hideEmojiTray();
          setTimeout(() => playScene(currentSceneIndex + 1), 600);
        });
      } else {
        // ❌ Wrong → say something and let them try again
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
  // wait for slide-down animation before hiding completely
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

  // Optional prompt line if you want it:
  if (interaction.prompt) {
    playDialogue([interaction.prompt], () => {});
  }

  mic.onclick = () => {
    mic.classList.add('hidden');
    mic.onclick = null;
    setTimeout(() => playScene(currentSceneIndex + 1), 400);
  };
}

// ---------- FX: Confetti ----------
function confettiBurst() {
  const fx = document.getElementById('fxLayer');
  if (!fx) return;

  const confettiFiles = [
    '/assets/ui/confetti-star.png',
    '/assets/ui/confetti-blue-ribbon.png',
    '/assets/ui/confetti-golden-ribbon.png',
    '/assets/ui/confetti-green-ribbon.png',
    '/assets/ui/confetti-pink-twirl.png'
  ];

  const count = 14;
  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = confettiFiles[i % confettiFiles.length];
    img.style.position = 'absolute';
    img.style.left = `${40 + Math.random() * 20}%`;
    img.style.top = `${40 + Math.random() * 10}%`;
    img.style.width = `${24 + Math.random() * 26}px`;
    img.style.opacity = '0.95';
    img.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;
    img.style.pointerEvents = 'none';

    const dx = (Math.random() - 0.5) * 500;
    const dy = -200 - Math.random() * 250;
    const rot = (Math.random() - 0.5) * 720;

    img.animate(
      [
        { transform: img.style.transform, offset: 0 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) rotate(${rot * 1.2}deg)`, opacity: 0, offset: 1 }
      ],
      { duration: 950 + Math.random() * 450, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );

    fx.appendChild(img);
    setTimeout(() => img.remove(), 1600);
  }
}

// ---------- Helpers ----------
function hideAllUI() {
  // Hide tray
  const tray = document.getElementById('emojiTray');
  if (tray) {
    tray.classList.remove('active');
    tray.classList.add('hidden');
    tray.setAttribute('aria-hidden', 'true');
  }

  // Hide mic
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

// Placeholder stubs (sprites later)
function setDrColi(state) {}
function setBori(state) {}
