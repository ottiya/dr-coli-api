// v2.js
// Episode One engine (Phase 3 – visuals + dialogue only)

let currentSceneIndex = 0;
let episodeData = null;

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
  // ✅ Set DEFAULT background immediately
  setBackground('bg-puppies.png');

  // Load episode data
  fetch('/lessons/episode-01.json')
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load episode JSON: ${res.status}`);
      }
      return res.json();
    })
    .then((data) => {
      episodeData = data;
      playScene(0);
    })
    .catch((err) => console.error(err));
});

// ---------- SCENE ENGINE ----------
function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.warn('No more scenes or scene not found:', index);
    return;
  }

  const scene = episodeData.scenes[index];

  // Scene-specific background (optional)
  if (scene.background) {
    setBackground(scene.background);
  }

  // Character states (placeholders for now)
  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  // Dialogue
  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

function enableInteraction(interaction) {
  // Phase 3: only auto-advance
  if (!interaction || interaction.type === 'none') {
    setTimeout(() => {
      playScene(currentSceneIndex + 1);
    }, 800);
    return;
  }

  console.log('Interaction not implemented yet:', interaction);
}

// ---------- UI HELPERS ----------
function setBackground(filename) {
  const bgLayer = document.getElementById('bgLayer');
  if (!bgLayer) return;

  const url = `/assets/backgrounds/${filename}`;
  bgLayer.style.backgroundImage = `url("${url}")`;
}

// Placeholder stubs (sprites come later)
function setDrColi(state) {
  // console.log('Dr. Coli animation:', state);
}

function setBori(state) {
  // console.log('Bori animation:', state);
}

// ---------- DIALOGUE ----------
function playDialogue(lines, onDone) {
  const dialogueEl = document.getElementById('dialogue');
  const textEl = document.getElementById('dialogueText');

  if (!dialogueEl || !textEl) {
    console.warn('Dialogue UI missing');
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

  const nextLine = () => {
    if (i >= lines.length) {
      setTimeout(() => {
        dialogueEl.classList.remove('active');
        onDone?.();
      }, 300);
      return;
    }

    textEl.textContent = lines[i];
    i += 1;

    setTimeout(nextLine, 1200);
  };

  nextLine();
}
