/* public/v2/js/audio.js
   Dr. Coli v2 Audio Module (no bundler needed)
   - Intro music sequence (play ~2s, fade out)
   - SFX helpers
   - ElevenLabs TTS with music ducking
*/

(() => {
  if (window.DrColiAudio) return;

  // ===== Paths =====
  const SFX_INTRO = "/assets/sound-effects/ottiya-korean-intro-song.wav";
  const SFX_CORRECT = "/assets/sound-effects/correct-sound-effect.wav";
  const SFX_KIDS_HOORAY = "/assets/sound-effects/kids-hooray.wav";
  const SFX_KIDS_YAY = "/assets/sound-effects/kids-yay.wav";
  const SFX_MIC_POP = "/assets/sound-effects/kids-giggle.wav";

  // ===== State =====
  let introMusic = null;
  let correctSfx = null;
  let kidsHooraySfx = null;
  let kidsYaySfx = null;
  let micPopSfx = null;

  let NORMAL_MUSIC_VOL = 0.6;
  let DUCKED_MUSIC_VOL = 0.22;

  function safePlay(aud) {
    if (!aud) return Promise.resolve();
    try {
      aud.currentTime = 0;
      return aud.play().catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  function init({ normalVol = 0.6, duckedVol = 0.22 } = {}) {
    NORMAL_MUSIC_VOL = normalVol;
    DUCKED_MUSIC_VOL = duckedVol;

    // Create once
    if (!introMusic) {
      introMusic = new Audio(SFX_INTRO);
      introMusic.loop = true;
      introMusic.volume = NORMAL_MUSIC_VOL;
    }

    if (!correctSfx) {
      correctSfx = new Audio(SFX_CORRECT);
      correctSfx.volume = 0.85;
    }

    if (!kidsHooraySfx) {
      kidsHooraySfx = new Audio(SFX_KIDS_HOORAY);
      kidsHooraySfx.volume = 0.55;
    }

    if (!kidsYaySfx) {
      kidsYaySfx = new Audio(SFX_KIDS_YAY);
      kidsYaySfx.volume = 0.55;
    }

    if (!micPopSfx) {
      micPopSfx = new Audio(SFX_MIC_POP);
      micPopSfx.volume = 0.18;
    }
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

  function duckMusicForSpeech(isDucked) {
    if (!introMusic) return;
    const target = isDucked ? DUCKED_MUSIC_VOL : NORMAL_MUSIC_VOL;
    const steps = 8;
    const start = introMusic.volume ?? NORMAL_MUSIC_VOL;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      const t = i / steps;
      introMusic.volume = start + (target - start) * t;
      if (i >= steps) clearInterval(iv);
    }, 35);
  }

  function fadeOutAudio(aud, ms = 900) {
    return new Promise((resolve) => {
      if (!aud) return resolve();
      const startVol = aud.volume ?? 0;
      const steps = 15;
      let i = 0;
      const iv = setInterval(() => {
        i++;
        const t = i / steps;
        aud.volume = Math.max(0, startVol * (1 - t));
        if (i >= steps) {
          clearInterval(iv);
          try {
            aud.pause();
            aud.currentTime = 0;
          } catch {}
          aud.volume = startVol;
          resolve();
        }
      }, Math.max(16, Math.floor(ms / steps)));
    });
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
    const pick =
      which === "kids"
        ? Math.random() < 0.5
          ? kidsHooraySfx
          : kidsYaySfx
        : which === "correct"
        ? correctSfx
        : which === "mic"
        ? micPopSfx
        : null;

    if (!pick) return;
    try {
      pick.currentTime = 0;
      pick.play().catch(() => {});
    } catch {}
  }

  // ElevenLabs TTS (ducks introMusic while speaking)
  async function speakElevenLabs(text, { rate = 1.25 } = {}) {
    try {
      duckMusicForSpeech(true);

      const res = await fetch("/api/tts-elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        console.warn("ElevenLabs TTS error:", res.status);
        duckMusicForSpeech(false);
        return;
      }

      const data = await res.json();
      const url = data?.url;
      if (!url) {
        duckMusicForSpeech(false);
        return;
      }

      const audio = new Audio(url);
      audio.playbackRate = rate;

      await audio.play();
      await new Promise((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });

      duckMusicForSpeech(false);
    } catch (err) {
      duckMusicForSpeech(false);
      console.warn("TTS playback failed (non-fatal):", err);
    }
  }

  window.DrColiAudio = {
    init,
    unlockAudioContext,
    playIntroSequence,
    playSfx,
    speakElevenLabs,
  };
})();
