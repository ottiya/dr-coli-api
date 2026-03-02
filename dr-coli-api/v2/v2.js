let currentSceneIndex = 0;
let episodeData = null;

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
  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.error('Scene not found:', index);
    return;
  }

  const scene = episodeData.scenes[index];

  setBackground(scene.background);
  setDrColi(scene.drColi?.animation || 'idle');
  setBori(scene.bori?.animation || 'idle');

  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: 'none' });
  });
}
