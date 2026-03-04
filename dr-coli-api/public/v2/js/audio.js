/* public/v2/js/audio.js */
/* Global audio helper for Dr. Coli v2 (no build system needed) */

(() => {
  if (window.DrColiAudio) return;

  // ===== Sound Effects (public/assets/sound-effects) =====
  const SFX_INTRO = "/assets/sound-effects/ottiya-korean-intro-song.wav";
  const SFX_CORRECT = "/assets/sound-effects/correct-sound-effect.wav";
  const SFX_KIDS_HOORAY = "/assets/sound-effects/kids-hooray.wav";
  const SFX_KIDS_YAY = "/assets/sound-effects/kids-yay.wav";
  const SFX_MIC_POP = "/assets/sound-effects/kids-giggle.wav"; // subtle “pop” substitute

  // Volume ducking
  const DUCKED_MUSIC_VOL = 0.22;
  const NORMAL_MUSIC_VOL = 0.6;

  // Audio objects
  let introMusic = null;
  let correctSfx = null;
  let kidsHooraySfx = null;
  let kidsYaySfx = null;
  let micPopSfx = null;

  function makeAudio(url, volume = 1) {
    const a = new Audio(url);
    a.preload = "auto";
    a.volume = volume;
    return a;
  }

  function init() {
    // Create once
    introMusic = introMusic || makeAudio(SFX_INTRO, NORMAL_MUSIC_VOL);
    correctSfx = correctSfx || makeAudio(SFX_CORRECT, 0.9);
    kidsHooraySfx = kidsHooraySfx || makeAudio(SFX_KIDS_HOORAY, 0.9);
    kidsYaySfx = kidsYaySfx || makeAudio(SFX_KIDS_YAY, 0.9);
    micPopSfx = micPopSfx || makeAudio(SFX_MIC_POP, 0.25);
  }

  async function unlockAudioContext() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
    } catch {
      // non-fatal
    }
  }

  function duckMusicForSpeech(duck) {
    try {
      if (!introMusic) return;
      introMusic.volume = duck ? DUCKED_MUSIC_VOL : NORMAL_MUSIC_VOL;
    } catch {
      // non-fatal
    }
  }

  async function fadeOutAudio(audio, ms = 900) {
    if (!audio) return;
    const startVol = audio.volume ?? 0.6;
    const steps = 18;
    const stepMs = Math.max(10, Math.floor(ms / steps));

    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      audio.volume = Math.max(0, startVol * (1 - t));
      await new Promise((r) => setTimeout(r, stepMs));
    }

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // non-fatal
    }

    // Restore default for next time
    audio.volume = startVol;
  }

  async function playIntroSequence({ holdMs = 2000, fadeMs = 900 } = {}) {
    init();
    try {
      if (introMusic) {
        introMusic.currentTime = 0;
        introMusic.volume = NORMAL_MUSIC_VOL;
        await introMusic.play();
      }
    } catch {
      // non-fatal
    }

    await new Promise((r) => setTimeout(r, holdMs));
    await fadeOutAudio(introMusic, fadeMs);
  }

  function playSfx(which) {
    init();
    const map = {
      correct: correctSfx,
      hooray: kidsHooraySfx,
      yay: kidsYaySfx,
      mic: micPopSfx,
    };
    const a = map[which];
    if (!a) return;

    try {
      a.currentTime = 0;
      a.play();
    } catch {
      // non-fatal
    }
  }

  window.DrColiAudio = {
    init,
    unlockAudioContext,
    duckMusicForSpeech,
    fadeOutAudio,
    playIntroSequence,
    playSfx,
  };
})();
