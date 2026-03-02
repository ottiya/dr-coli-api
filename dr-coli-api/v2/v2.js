// v2.js (Phase 3 skeleton: load episode JSON → play scene → enable interaction)

let currentSceneIndex = 0;
let episodeData = null;

fetch('/lessons/episode-01.json')
  .then((res) => {
    if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
    return res.json();
  })
  .then((data) => {
    episodeData = data;
    playScene(0);
  })
  .catch((err) => console.error(err));

function playScene(index) {
  // ✅ Keep index in sync so "next scene" is always reliable
  currentSceneIndex = index;

  // ✅ Guard against missing/invalid scene
  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.error('Scene not found:', index);
    return;
  }

  const scene = episodeData.scenes[index];

  // ✅ Background: allow scene override, otherwise fall back to episode default
  setBackground(scene.background || episodeData.background);

  // ✅ Character animations: safe defaults
  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  // ✅ Dialogue: safe default to empty array
  const lines = scene.drColi?.say || [];

  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}

/**
 * Phase 3C v1: only handles "none" by auto-advancing.
 * We'll add "emoji" and "repeat" next.
 */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === 'none') {
    // Auto-advance after a short beat
    setTimeout(() => {
      playScene(currentSceneIndex + 1);
    }, 800);
    return;
  }

  // Placeholder for upcoming interaction types:
  // - emoji
  // - repeat (mic)
  console.log('Interaction not implemented yet:', interaction);
}
