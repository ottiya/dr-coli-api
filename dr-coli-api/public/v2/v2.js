// v2.js

let currentSceneIndex = 0;
let episodeData = null;

// ---------- Boot ----------
fetch('/lessons/episode-01.json')
  .then((res) => {
    if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
    return res.json();
  })
  .then((data) => {
    episodeData = data;

    // Optional: set a default background if your episode JSON doesn't have one yet
    if (episodeData.background) setBackground(episodeData.background);

    playScene(0);
  })
  .catch((err) => console.error(err));

// ---------- Scene Engine ----------
function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.error('Scene not found:', index);
    return;
  }

  const scene = episodeData.scenes[index];

  setBackground(scene.background || episodeData.background);

  // These are placeholders for now. You can keep them even if not implemented yet.
  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    setTimeout(() => {
      playScene(currentSceneIndex + 1);
    }, 800);
    return;
  }

  console.log('Interaction not implemented yet:', interaction);
}

// ---------- UI Helpers ----------
function setBackground(bg) {
  // bg can be a full path like "/assets/backgrounds/puppy.png"
  // or a filename like "puppy.png" (we'll resolve it)
  const bgLayer = document.getElementById('bgLayer');
  if (!bgLayer) return;

  const url = bg.startsWith('/') ? bg : `/assets/backgrounds/${bg}`;
  bgLayer.style.backgroundImage = `url("${url}")`;
}

// Placeholder stubs so your console doesn't explode if not implemented yet
function setDrColi(state) {
  // TODO: hook Pixi / sprite later
  // console.log('Dr. Coli state:', state);
}
function setBori(state) {
  // TODO: hook Pixi / sprite later
  // console.log('Bori state:', state);
}

function playDialogue(lines, onDone) {
  const dialogueEl = document.getElementById('dialogue');
  const textEl = document.getElementById('dialogueText');

  if (!dialogueEl || !textEl) {
    console.warn('Dialogue UI not found (#dialogue / #dialogueText).');
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

    setTimeout(next, 1200);
  };

  next();
}
