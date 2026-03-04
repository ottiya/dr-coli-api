/* public/v2/v2.js */
/* Pixi v7 + lazy-load sheets + ElevenLabs TTS + OpenAI STT mic check (kid-forgiving) */

(() => {
  if (window.__DRCOLI_V2_BOOTED__) return;
  window.__DRCOLI_V2_BOOTED__ = true;

  // ===== Constants =====
  const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
  const EPISODE_URL = "/lessons/episode-01.json";
  const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

  // Theme mapping (Start Screen)
  const THEME_BG = {
    puppies: "/assets/backgrounds/bg-puppies.png",
    dino: "/assets/backgrounds/bg-dinos.png",
    airport: "/assets/backgrounds/bg-planes.png",
  };
  const STORAGE_THEME_KEY = "drcoli_theme";
  const STORAGE_NAME_KEY = "drcoli_kidname";

  // TTS
  const TTS_RATE = 1.25; // faster speaking
  const BETWEEN_LINES_MS = 80; // less delay between lines

  // ===== Sound Effects (public/assets/sound-effects) =====
  const SFX_INTRO = "/assets/sound-effects/ottiya-korean-intro-song.wav";
  const SFX_CORRECT = "/assets/sound-effects/correct-sound-effect.wav";
  const SFX_KIDS_HOORAY = "/assets/sound-effects/kids-hooray.wav";
  const SFX_KIDS_YAY = "/assets/sound-effects/kids-yay.wav";
  const SFX_MIC_POP = "/assets/sound-effects/kids-giggle.wav";

  // STT
  const STT_MODEL = "gpt-4o-mini-transcribe";
  const STT_LANGUAGE = "ko";
  const RECORD_MS = 2200;
  const SPEECH_RMS_THRESHOLD = 0.04;
  const MIN_SPEECH_MS = 140;

  // ===== Confetti images =====
  const CONFETTI_IMAGES = [
    "/assets/ui/confetti-blue-ribbon.png",
    "/assets/ui/confetti-golden-ribbon.png",
    "/assets/ui/confetti-green-ribbon.png",
    "/assets/ui/confetti-pink-twirl.png",
    "/assets/ui/confetti-star.png",
  ];

  // ===== State =====
  let currentSceneIndex = 0;
  let currentSceneId = null;

  let micBusy = false;
  let sceneRunId = 0;
  let pendingAdvanceTimer = null;
  let episodeData = null;
  let characterManifest = null;

  let pixiApp = null;
  let drColiSprite = null;
  let boriSprite = null;

  // cache: characterKey -> stateName -> textures[]
  const textureCache = { drColi: {}, bori: {} };
  const charState = { drColi: "idle", bori: "idle" };

  // ===== Stars (Mission Progress) =====
  let starsEarned = 0;
  const starredScenes = new Set(); // prevent duplicate stars per scene
  let missionBarEl = null;
  let starEls = [];

  // DOM
  let bgLayer,
    dialogueEl,
    dialogueTextEl,
    emojiTrayEl,
    micButtonEl,
    fxLayerEl,
    stageLayerEl;

  // Start screen DOM
  let startScreenEl = null;
  let startButtonEl = null;
  let kidNameEl = null;
  let themeTiles = [];
  let selectedTheme = "puppies";

  // Audio unlock gate
  let userInteracted = false;
  let unlockPromise = null;
  let resolveUnlock = null;

  // ===== SFX / Music objects =====
  let introMusic = null;
  let correctSfx = null;
  let kidsHooraySfx = null;
  let kidsYaySfx = null;
  let micPopSfx = null;

  // Music start gating
  let assetsReadyToStart = false;
  let introSequenceDone = false;

  // Volume ducking
  const DUCKED_MUSIC_VOL = 0.22;
  const NORMAL_MUSIC_VOL = 0.6;

  document.addEventListener("DOMContentLoaded", () => {
    bgLayer = document.getElementById("bgLayer");
    dialogueEl = document.getElementById("dialogue");
    dialogueTextEl = document.getElementById("dialogueText");
    emojiTrayEl = document.getElementById("emojiTray");
    micButtonEl = document.getElementById("micButton");
    fxLayerEl = document.getElementById("fxLayer");
    stageLayerEl = document.getElementById("stageLayer");

    // Start screen elements (already in your HTML)
    startScreenEl = document.getElementById("startScreen");
    startButtonEl = document.getElementById("startButton");
    kidNameEl = document.getElementById("kidName");
    themeTiles = Array.from(document.querySelectorAll(".theme-tile"));

    // Mission bar
    missionBarEl = document.getElementById("missionBar");
    initStarsUI(); // safe even if missionBar isn't present

    if (
      !bgLayer ||
      !dialogueEl ||
      !dialogueTextEl ||
      !emojiTrayEl ||
      !micButtonEl ||
      !fxLayerEl ||
      !stageLayerEl
    ) {
      console.error(
        "Missing required DOM elements. Check index.html for: bgLayer, stageLayer, UI elements."
      );
      return;
    }

    applyDialogueLayoutFix();
    initSfx();

    // IMPORTANT: We do NOT show the old “Tap to start” overlay anymore.
    // The Start button handles audio unlock + intro sequence now.
    initStartScreen();

    boot().catch((err) => console.error("BOOT ERROR:", err));
  });

  // ===== Start Screen =====
  function initStartScreen() {
    // Build unlockPromise once; Start button will resolve it.
    if (!unlockPromise) {
      unlockPromise = new Promise((resolve) => {
        resolveUnlock = resolve;
      });
    }

    // Hide mission bar until lesson starts (so it doesn't appear over the start card)
    if (missionBarEl) missionBarEl.style.display = "none";

    // Load last saved values
    const savedTheme = (localStorage.getItem(STORAGE_THEME_KEY) || "").trim();
    const savedName = (localStorage.getItem(STORAGE_NAME_KEY) || "").trim();

    if (THEME_BG[savedTheme]) selectedTheme = savedTheme;
    else selectedTheme = "puppies";

    if (kidNameEl) kidNameEl.value = savedName;

    // Set initial background behind the card
    setBackground(THEME_BG[selectedTheme] || DEFAULT_BG);

    // Set selected tile UI
    setSelectedThemeTile(selectedTheme);

    // Wire theme tile clicks
    themeTiles.forEach((tile) => {
      tile.addEventListener("click", () => {
        const theme = tile.getAttribute("data-theme");
        if (!THEME_BG[theme]) return;
        selectedTheme = theme;

        setSelectedThemeTile(selectedTheme);
        setBackground(THEME_BG[selectedTheme]);
      });
    });

    // Wire Start button click
    if (startButtonEl) {
      startButtonEl.addEventListener("click", async () => {
        // prevent double-click chaos
        startButtonEl.disabled = true;

        // Save name + theme (sticky)
        const name = (kidNameEl?.value || "").trim();
        localStorage.setItem(STORAGE_THEME_KEY, selectedTheme);
        localStorage.setItem(STORAGE_NAME_KEY, name);

        // Audio unlock gate
        userInteracted = true;
        if (resolveUnlock) resolveUnlock();

        await unlockAudioContext();

        // Intro music: start → hold ~2s → fade out → start lesson
        try {
          if (introMusic) {
            introMusic.currentTime = 0;
            introMusic.volume = NORMAL_MUSIC_VOL;
            await introMusic.play();
          }
        } catch {
          // non-fatal
        }

        await sleep(2000);
        await fadeOutAudio(introMusic, 900);

        // Hide start screen
        if (startScreenEl) startScreenEl.style.display = "none";

        // Now allow lesson start
        introSequenceDone = true;

        // Show mission bar once lesson begins (we tie it to dialogue too)
        if (missionBarEl) missionBarEl.style.display = "";

        maybeStartEpisode();
      });
    }
  }

  function setSelectedThemeTile(theme) {
    themeTiles.forEach((t) => t.classList.remove("selected"));
    const el = themeTiles.find((t) => t.getAttribute("data-theme") === theme);
    if (el) el.classList.add("selected");
  }

  // ===== Stars helpers =====
  function initStarsUI() {
    if (!missionBarEl) return;
    starEls = Array.from(missionBarEl.querySelectorAll(".star"));
  }

  function resetStars() {
    starsEarned = 0;
    starredScenes.clear();
    if (!starEls.length) initStarsUI();
    starEls.forEach((el) => {
      el.textContent = "☆";
      el.classList.remove("pop");
    });
  }

  function awardStar(sceneId) {
    if (!sceneId) return;
    if (starredScenes.has(sceneId)) return;
    if (!starEls.length) initStarsUI();
    if (!starEls.length) return;
    if (starsEarned >= starEls.length) return;

    starredScenes.add(sceneId);

    const el = starEls[starsEarned];
    starsEarned += 1;

    if (!el) return;
    el.textContent = "⭐";

    // pop animation (CSS handles it)
    el.classList.remove("pop");
    void el.offsetWidth; // force reflow so animation can replay
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 260);
  }

  async function boot() {
    // Start screen already set the background. Boot can keep it.
    initPixi();

    // Pixi v7 Assets init
    if (PIXI.Assets?.init) {
      await PIXI.Assets.init({ manifest: null }).catch(() => {});
    }

    // Load episode + manifest in parallel
    const [ep, man] = await Promise.all([
      fetchJSON(EPISODE_URL),
      fetchJSON(CHARACTER_MANIFEST_URL),
    ]);

    episodeData = ep;

    characterManifest = normalizeManifest(man);

    // Fast boot: load minimum states only
    await Promise.all([
      ensureStateLoaded("drColi", "idle"),
      ensureStateLoaded("bori", "idle"),
      ensureStateLoaded("drColi", "talk").catch(() => {}),
      ensureStateLoaded("bori", "look").catch(() => {}),
    ]);

    createCharacters();
    assetsReadyToStart = true;
    maybeStartEpisode();
  }

  function maybeStartEpisode() {
    if (!assetsReadyToStart) return;
    if (!introSequenceDone) return;

    if (maybeStartEpisode.__started) return;
    maybeStartEpisode.__started = true;

    resetStars();
    playScene(0);
  }

  function normalizeManifest(man) {
    const out = { drColi: null, bori: null };

    out.drColi =
      man?.drColi ||
      man?.DrColi ||
      man?.drcoli ||
      man?.["dr-coli"] ||
      man?.["dr_coli"] ||
      null;
    out.bori = man?.bori || man?.Bori || null;

    return out.drColi || out.bori ? out : man;
  }

  function initPixi() {
    pixiApp = new PIXI.Application({
      backgroundAlpha: 0,
      resizeTo: stageLayerEl,
      antialias: true,
    });
    stageLayerEl.appendChild(pixiApp.view);
    window.addEventListener("resize", positionCharacters);
  }

  function createCharacters() {
    const drIdle = textureCache.drColi.idle || [];
    const boriIdle = textureCache.bori.idle || [];

    drColiSprite = new PIXI.AnimatedSprite(
      drIdle.length ? drIdle : [PIXI.Texture.WHITE]
    );
    boriSprite = new PIXI.AnimatedSprite(
      boriIdle.length ? boriIdle : [PIXI.Texture.WHITE]
    );

    drColiSprite.anchor.set(0.5, 1);
    boriSprite.anchor.set(0.5, 1);

    pixiApp.stage.addChild(drColiSprite);
    pixiApp.stage.addChild(boriSprite);

    positionCharacters();

    playCharacterState(drColiSprite, drIdle, { speed: 0.22, pingpong: true });
    playCharacterState(boriSprite, boriIdle, { speed: 0.22, pingpong: true });
  }

  function positionCharacters() {
    if (!pixiApp || !drColiSprite || !boriSprite) return;

    const w = pixiApp.renderer.width;
    const h = pixiApp.renderer.height;

    const scale = clamp(Math.min(w / 1200, h / 675), 0.3, 0.62);
    drColiSprite.scale.set(scale);
    boriSprite.scale.set(scale);

    // If you want them LOWER (closer to the tennis ball),
    // increase this margin a bit smaller:
    const margin = clamp(h * 0.016, 10, 22);
    const groundY = h - margin;

    const gap = clamp(w * 0.18, 140, 360);
    const cx = w * 0.5;

    drColiSprite.x = cx - gap / 2;
    boriSprite.x = cx + gap / 2;

    drColiSprite.y = groundY + 0;
    boriSprite.y = groundY + 10;
  }

  function playCharacterState(
    sprite,
    textures,
    { speed = 0.22, pingpong = true } = {}
  ) {
    if (!sprite) return;
    if (!textures || textures.length === 0) {
      sprite.stop();
      return;
    }
    sprite.textures = textures;

    if (textures.length === 1) {
      sprite.stop();
      sprite.gotoAndStop(0);
      return;
    }

    const abs = Math.abs(speed || 0.22);
    sprite.loop = true;
    sprite._pingpong = !!pingpong;
    sprite._ppAbs = abs;
    sprite.animationSpeed = abs;

    sprite.onFrameChange = (frame) => {
      if (!sprite._pingpong) return;
      if (frame === sprite.textures.length - 1)
        sprite.animationSpeed = -sprite._ppAbs;
      else if (frame === 0) sprite.animationSpeed = sprite._ppAbs;
    };

    sprite.play();
  }

  async function setDrColi(state, opts = {}) {
    charState.drColi = state;
    await ensureStateLoaded("drColi", state);
    playCharacterState(drColiSprite, textureCache.drColi[state], {
      speed: 0.22,
      pingpong: true,
      ...opts,
    });
  }

  async function setBori(state, opts = {}) {
    charState.bori = state;
    await ensureStateLoaded("bori", state);
    playCharacterState(boriSprite, textureCache.bori[state], {
      speed: 0.22,
      pingpong: true,
      ...opts,
    });
  }

  async function ensureStateLoaded(characterKey, stateName) {
    if (textureCache[characterKey]?.[stateName]?.length) return;

    const entry = characterManifest?.[characterKey]?.[stateName];
    if (!entry) {
      textureCache[characterKey][stateName] = [];
      return;
    }

    const jsonUrls = Array.isArray(entry) ? entry : [entry];
    const textures = [];

    for (const jsonUrl of jsonUrls) {
      const sheetTextures = await loadSpritesheetTexturesSafe(
        jsonUrl,
        `${characterKey}.${stateName}`
      );
      textures.push(...sheetTextures);
    }

    textureCache[characterKey][stateName] = textures;
  }

  function naturalCompare(a, b) {
    const ax = [];
    const bx = [];
    a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => ax.push([$1 || Infinity, $2 || ""]));
    b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => bx.push([$1 || Infinity, $2 || ""]));
    while (ax.length && bx.length) {
      const an = ax.shift();
      const bn = bx.shift();
      const nn = an[0] - bn[0] || an[1].localeCompare(bn[1]);
      if (nn) return nn;
    }
    return ax.length - bx.length;
  }

  async function loadSpritesheetTexturesSafe(jsonUrl, label) {
    try {
      const loaded = await PIXI.Assets.load(jsonUrl);
      const sheet = loaded?.textures
        ? loaded
        : loaded?.spritesheet?.textures
        ? loaded.spritesheet
        : null;

      if (!sheet || !sheet.textures) {
        console.warn(`[sheet] No textures for ${label}: ${jsonUrl}`);
        return [];
      }

      const keys = Object.keys(sheet.textures).sort(naturalCompare);
      return keys.map((k) => sheet.textures[k]);
    } catch (err) {
      console.error(`[sheet] Failed ${label}: ${jsonUrl}`, err);
      return [];
    }
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return await res.json();
  }

  function setBackground(bgFileOrUrl) {
    const url =
      bgFileOrUrl.startsWith("http") || bgFileOrUrl.startsWith("/")
        ? bgFileOrUrl
        : `/assets/backgrounds/${bgFileOrUrl}`;
    bgLayer.style.backgroundImage = `url("${url}")`;
  }

  function playScene(index) {
    sceneRunId++;
    if (pendingAdvanceTimer) {
      clearTimeout(pendingAdvanceTimer);
      pendingAdvanceTimer = null;
    }
    currentSceneIndex = index;
    const scene = episodeData?.scenes?.[index];
    if (!scene) return;

    currentSceneId = scene.id || String(index);

    setBackground(scene.background || episodeData.background || DEFAULT_BG);

    setDrColi(scene.drColi?.animation || "idle").catch(() => {});
    setBori(scene.bori?.animation || "idle").catch(() => {});

    const lines = scene.drColi?.say || [];
    playDialogue(lines, () =>
      enableInteraction(scene.interaction || { type: "none" })
    );
  }

  async function playDialogue(lines, done) {
    if (!lines || lines.length === 0) {
      hideDialogue();
      done?.();
      return;
    }
    showDialogue();

    for (const line of lines) {
      const msg = String(line ?? "").trim();
      if (!msg) continue;

      dialogueTextEl.textContent = msg;
      await setDrColi("talk").catch(() => {});
      await speakLine(msg);
      await setDrColi("idle").catch(() => {});
      await sleep(BETWEEN_LINES_MS);
    }

    done?.();
  }

  function showDialogue() {
    dialogueEl.classList.add("active");
    // Make mission bar feel “paired” with the dialogue bubble
    if (missionBarEl) missionBarEl.classList.add("active");
  }

  function hideDialogue() {
    dialogueEl.classList.remove("active");
    dialogueTextEl.textContent = "";
    if (missionBarEl) missionBarEl.classList.remove("active");
  }

  // ===== Audio unlock + gating =====
  // Old overlay UI removed; we keep unlock logic and wait for Start button.
  function ensureStartOverlay() {
    // no-op (kept so older calls won’t crash)
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

  async function waitForUserInteraction() {
    // After Start button, this is true and audio will play normally.
    if (userInteracted) return;

    // If something calls speakLine early, wait until Start is pressed.
    if (unlockPromise) await unlockPromise;
  }

  // ===== ElevenLabs TTS + ducking =====
  async function speakLine(text) {
    try {
      await waitForUserInteraction();

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
      audio.playbackRate = TTS_RATE;

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

  // ===== Interaction handling =====
  function enableInteraction(interaction) {
    const type = interaction?.type || "none";

    emojiTrayEl.classList.add("hidden");
    micButtonEl.classList.add("hidden");
    micButtonEl.classList.remove("listening");
    micButtonEl.classList.remove("attention");
    micButtonEl.classList.remove("processing");
    micButtonEl.onclick = null;

    if (type === "none") return autoAdvance();
    if (type === "emoji") return showEmojiInteraction(interaction);
    if (type === "mic") return showMicInteraction(interaction);

    autoAdvance();
  }

  function autoAdvance() {
    const myRun = sceneRunId;
    if (pendingAdvanceTimer) clearTimeout(pendingAdvanceTimer);

    pendingAdvanceTimer = setTimeout(() => {
      if (myRun !== sceneRunId) return;
      playScene(currentSceneIndex + 1);
    }, 350);
  }

  function showEmojiInteraction(interaction) {
    const choices = interaction.choices || [];
    const correctIndex = interaction.correctIndex ?? 0;

    emojiTrayEl.classList.remove("hidden");
    emojiTrayEl.classList.add("active");

    const buttons = emojiTrayEl.querySelectorAll(".emoji-slot");
    buttons.forEach((btn, i) => {
      btn.textContent = choices[i] || "";
      btn.onclick = async () => {
        if (i === correctIndex) {
          awardStar(currentSceneId);
          await celebrateCorrect(interaction.onCorrectSay || "Yes!! Amazing job!");

          emojiTrayEl.classList.remove("active");
          setTimeout(() => {
            emojiTrayEl.classList.add("hidden");
            playScene(currentSceneIndex + 1);
          }, 200);
        } else {
          await speakLine(
            interaction.onWrongSay?.[0] || "Nice try! Let’s try again."
          );
        }
      };
    });
  }

  // ===== Mic interaction =====
  function showMicInteraction(interaction) {
    const targets = Array.isArray(interaction?.targets)
      ? interaction.targets.map((t) => String(t || "").trim()).filter(Boolean)
      : [
          String(
            interaction?.target ||
              interaction?.phrase ||
              interaction?.expected ||
              ""
          ).trim(),
        ].filter(Boolean);

    const strictness = interaction?.strictness || "easy";

    const prompt =
      interaction?.prompt ||
      (targets[0]
        ? `Tap the mic, then say ${targets[0]}!`
        : "Tap the mic, then speak!");

    micButtonEl.classList.remove("hidden");
    micButtonEl.classList.remove("listening");
    micButtonEl.classList.remove("processing");
    micButtonEl.classList.add("attention");
    micButtonEl.disabled = true;

    dialogueEl.classList.add("active");
    dialogueTextEl.textContent = prompt;

    playSfx(micPopSfx);

    (async () => {
      try {
        await setDrColi("talk").catch(() => {});
        await speakLine(prompt);
      } finally {
        await setDrColi("idle").catch(() => {});
        await setBori("idle").catch(() => {});
        micButtonEl.disabled = false;
        micButtonEl.classList.add("attention");
      }
    })();

    micButtonEl.onclick = async () => {
      const myRun = sceneRunId;
      if (micBusy) return;
      micBusy = true;

      try {
        await waitForUserInteraction();

        micButtonEl.classList.remove("attention");
        micButtonEl.classList.add("listening");
        micButtonEl.classList.remove("processing");
        micButtonEl.disabled = true;

        setDrColi("idle").catch(() => {});
        setBori("idle").catch(() => {});

        const { blob, speechStarted } = await recordOnceWithSpeechDetect({
          ms: RECORD_MS,
        });

        if (myRun !== sceneRunId) return;

        micButtonEl.classList.remove("listening");

        if (!speechStarted) {
          const silentLine = "Hmm… I didn’t hear anything. Let’s try again!";
          dialogueEl.classList.add("active");
          dialogueTextEl.textContent = silentLine;
          await setDrColi("talk").catch(() => {});
          await speakLine(silentLine);
          await setDrColi("idle").catch(() => {});
          if (myRun !== sceneRunId) return;

          micButtonEl.disabled = false;
          micButtonEl.classList.add("attention");
          return;
        }

        const checkPromise = listenAndCheckPhrase(targets, strictness, blob);

        micButtonEl.classList.add("processing");
        dialogueEl.classList.add("active");
        dialogueTextEl.textContent = "One moment!";

        await setDrColi("talk").catch(() => {});
        const oneMomentPromise = speakLine("One moment!");
        const minProcessingTime = sleep(350);

        const [result] = await Promise.all([
          checkPromise,
          minProcessingTime,
          oneMomentPromise,
        ]).then(([r]) => [r]);

        await setDrColi("idle").catch(() => {});
        micButtonEl.classList.remove("processing");

        if (myRun !== sceneRunId) return;

        micButtonEl.disabled = false;

        if (result.ok) {
          awardStar(currentSceneId);
          await celebrateCorrect(interaction?.onSuccessSay || "Yes!! Amazing job!");

          if (myRun !== sceneRunId) return;
          micButtonEl.classList.add("hidden");
          playScene(currentSceneIndex + 1);
        } else {
          const failLine =
            interaction?.onFailSay?.[0] ||
            "So close! Let’s try together one more time.";
          dialogueEl.classList.add("active");
          dialogueTextEl.textContent = failLine;
          await setDrColi("talk").catch(() => {});
          await speakLine(failLine);
          await setDrColi("idle").catch(() => {});
          if (myRun !== sceneRunId) return;

          micButtonEl.classList.add("attention");
        }
      } finally {
        micBusy = false;
      }
    };
  }

  async function listenAndCheckPhrase(targets, strictness, blobOverride = null) {
    try {
      const list = Array.isArray(targets)
        ? targets.map((t) => String(t || "").trim()).filter(Boolean)
        : [String(targets || "").trim()].filter(Boolean);

      const blob = blobOverride || (await recordOnce({ ms: RECORD_MS }));
      const transcript = await sttViaOpenAI(blob);

      const cleaned = normalizeKo(transcript);
      if (!cleaned) return { ok: false, transcript: transcript || "" };

      if (!list.length) return { ok: true, transcript };

      for (const t of list) {
        if (kidForgivingMatchAdvanced(transcript, t, strictness)) {
          return { ok: true, transcript };
        }
      }
      return { ok: false, transcript };
    } catch (e) {
      console.warn("STT mic flow failed:", e);
      return { ok: false, transcript: "" };
    }
  }

  async function recordOnce({ ms = 2600 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];

    return await new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onerror = (e) => reject(e.error || e);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      setTimeout(() => rec.stop(), ms);
    });
  }

  async function recordOnceWithSpeechDetect({
    ms = RECORD_MS,
    minSpeakMs = MIN_SPEECH_MS,
    rmsThreshold = SPEECH_RMS_THRESHOLD,
  } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];

    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let interval = null;
    let speechStarted = false;
    let speakAccum = 0;
    let lastT = performance.now();

    try {
      ctx = AC ? new AC() : null;
      if (ctx) {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);

        const data = new Uint8Array(analyser.fftSize);

        interval = setInterval(() => {
          const now = performance.now();
          const dt = now - lastT;
          lastT = now;

          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);

          if (rms > rmsThreshold) speakAccum += dt;
          else speakAccum = Math.max(0, speakAccum - dt * 0.5);

          if (!speechStarted && speakAccum >= minSpeakMs) speechStarted = true;
        }, 50);
      }

      const blob = await new Promise((resolve, reject) => {
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        rec.onerror = (e) => reject(e.error || e);
        rec.onstop = () =>
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        rec.start();
        setTimeout(() => rec.stop(), ms);
      });

      return { blob, speechStarted };
    } finally {
      if (interval) clearInterval(interval);
      try {
        if (ctx) await ctx.close();
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
    }
  }

  async function sttViaOpenAI(blob) {
    const fd = new FormData();
    fd.append("file", blob, "speech.webm");
    fd.append("model", STT_MODEL);
    fd.append("language", STT_LANGUAGE);

    const res = await fetch("/api/stt", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    return (data?.text || "").trim();
  }

  function normalizeKo(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[\s\.\,\!\?\-_\(\)\[\]\{\}"'~]/g, "");
  }

  function toJamo(str) {
    const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
    const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

    let out = "";
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code < 0xac00 || code > 0xd7a3) {
        out += ch;
        continue;
      }
      const sIndex = code - 0xac00;
      const cho = Math.floor(sIndex / (21 * 28));
      const jung = Math.floor((sIndex % (21 * 28)) / 28);
      const jong = sIndex % 28;
      out += CHO[cho] + JUNG[jung] + (JONG[jong] || "");
    }
    return out;
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () =>
      new Array(b.length + 1).fill(0)
    );
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }

  function kidForgivingMatchAdvanced(spoken, target, strictness = "easy") {
    const s0 = normalizeKo(spoken);
    const t0 = normalizeKo(target);
    if (!s0 || !t0) return false;
    if (s0 === t0) return true;

    const s = s0.replace(/(요|이요|으)$/g, "");
    const t = t0.replace(/(요|이요|으)$/g, "");

    if (s.includes(t) || t.includes(s)) return true;

    const sj = toJamo(s);
    const tj = toJamo(t);
    const dist = levenshtein(sj, tj);
    const L = Math.max(sj.length, tj.length);

    let maxEdits;
    if (strictness === "strict") maxEdits = L <= 10 ? 1 : 2;
    else if (strictness === "normal")
      maxEdits = L <= 6 ? 1 : L <= 12 ? 2 : 3;
    else maxEdits = L <= 6 ? 2 : L <= 12 ? 3 : 4;

    return dist <= maxEdits;
  }

  // ===== Celebration + confetti + SFX stack =====
  async function celebrateCorrect(praiseLines) {
    const prevDr = charState.drColi;
    const prevBori = charState.bori;

    await setDrColi("wave").catch(() => {});
    await setBori("wave").catch(() => {});

    playSfx(correctSfx);

    setTimeout(() => {
      const pick = Math.random() < 0.5 ? kidsHooraySfx : kidsYaySfx;
      playSfx(pick);
    }, 150);

    spawnFullScreenConfetti();

    const lines = Array.isArray(praiseLines)
      ? praiseLines.map((x) => String(x || "").trim()).filter(Boolean)
      : [String(praiseLines || "").trim()].filter(Boolean);

    for (const line of lines) {
      dialogueEl.classList.add("active");
      dialogueTextEl.textContent = line;
      await speakLine(line);
      await sleep(BETWEEN_LINES_MS);
    }

    await setDrColi(prevDr).catch(() => {});
    await setBori(prevBori).catch(() => {});
  }

  function spawnFullScreenConfetti() {
    const N = 60;
    const w = fxLayerEl.clientWidth || window.innerWidth;
    const h = fxLayerEl.clientHeight || window.innerHeight;

    for (let i = 0; i < N; i++) {
      const img = document.createElement("img");
      img.src = CONFETTI_IMAGES[(Math.random() * CONFETTI_IMAGES.length) | 0];
      img.alt = "";
      img.style.position = "absolute";
      img.style.left = Math.random() * w + "px";
      img.style.top = -80 - Math.random() * 160 + "px";
      img.style.width = 16 + Math.random() * 16 + "px";
      img.style.height = "auto";
      img.style.opacity = String(0.92 + Math.random() * 0.08);
      img.style.zIndex = "100";
      img.style.pointerEvents = "none";
      fxLayerEl.appendChild(img);

      const drift = (Math.random() - 0.5) * 360;
      const sway = (Math.random() - 0.5) * 180;
      const dur = 1800 + Math.random() * 2800;

      const rot0 = Math.random() * 360;
      const rot1 = rot0 + (Math.random() * 540 + 180);
      const rot2 = rot1 + (Math.random() * 540 + 180);

      const startDelay = Math.random() * 220;

      const easing =
        Math.random() < 0.5
          ? "cubic-bezier(.18,.70,.20,1)"
          : "cubic-bezier(.10,.80,.25,1)";

      setTimeout(() => {
        img.animate(
          [
            { transform: `translate(0px, 0px) rotate(${rot0}deg)` },
            {
              transform: `translate(${drift * 0.35 + sway}px, ${
                (h + 120) * 0.45
              }px) rotate(${rot1}deg)`,
            },
            {
              transform: `translate(${drift}px, ${h + 160}px) rotate(${rot2}deg)`,
            },
          ],
          { duration: dur, easing, fill: "forwards" }
        );

        setTimeout(() => img.remove(), dur + 250);
      }, startDelay);
    }
  }

  function applyDialogueLayoutFix() {
    dialogueEl.style.left = "50%";
    dialogueEl.style.transform = "translateX(-50%)";
    dialogueEl.style.top = "18px";
    dialogueEl.style.bottom = "auto";
    dialogueEl.style.width = "min(92vw, 900px)";
    dialogueEl.style.height = "auto";

    dialogueTextEl.style.fontSize = "clamp(18px, 3.2vw, 38px)";
    dialogueTextEl.style.top = "22px";
    dialogueTextEl.style.left = "52px";
    dialogueTextEl.style.right = "52px";
  }

  function initSfx() {
    introMusic = new Audio(SFX_INTRO);
    introMusic.loop = true;
    introMusic.volume = NORMAL_MUSIC_VOL;

    correctSfx = new Audio(SFX_CORRECT);
    correctSfx.volume = 0.85;

    kidsHooraySfx = new Audio(SFX_KIDS_HOORAY);
    kidsHooraySfx.volume = 0.55;

    kidsYaySfx = new Audio(SFX_KIDS_YAY);
    kidsYaySfx.volume = 0.55;

    micPopSfx = new Audio(SFX_MIC_POP);
    micPopSfx.volume = 0.18;
  }

  function playSfx(aud) {
    if (!aud) return;
    try {
      aud.currentTime = 0;
      aud.play().catch(() => {});
    } catch {}
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
})();
