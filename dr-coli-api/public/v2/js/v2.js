/* public/v2/js/v2.js */
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

  // ===== Personalization (kid name) =====
  function getKidName() {
    const raw = (localStorage.getItem(STORAGE_NAME_KEY) || "").trim();
    return raw || "friend";
  }

  function personalizeText(text) {
    const name = getKidName();
    return String(text ?? "").replaceAll("{name}", name);
  }

  // TTS
  const TTS_RATE = 1.25; // faster speaking
  const BETWEEN_LINES_MS = 80; // less delay between lines

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
  let missionTextEl = null;
  let missionTextTimer = null;

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

  // Audio gate (we still keep this in v2.js)
  let userInteracted = false;
  let unlockPromise = null;
  let resolveUnlock = null;

  // Music start gating
  let assetsReadyToStart = false;
  let introSequenceDone = false;

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
    missionTextEl = document.getElementById("missionText");
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

    // Init audio module
    window.DrColiAudio?.init?.({ normalVol: 0.6, duckedVol: 0.22 });

    // Start button handles audio unlock + intro sequence
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

    // Hide mission bar until lesson starts
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

    // Start button begins disabled until characters are loaded
    if (startButtonEl) {
      startButtonEl.disabled = true;
      startButtonEl.textContent = "Waiting for Dr. Coli and Bori…🐶";
    }

    // Wire Start button click
    if (startButtonEl) {
      startButtonEl.addEventListener("click", async () => {
        if (!assetsReadyToStart) return;
        startButtonEl.disabled = true;

        // Save name + theme (sticky)
        const name = (kidNameEl?.value || "").trim();
        localStorage.setItem(STORAGE_THEME_KEY, selectedTheme);
        localStorage.setItem(STORAGE_NAME_KEY, name);

        // Audio gate: allow TTS and SFX
        userInteracted = true;
        if (resolveUnlock) resolveUnlock();

        await window.DrColiAudio?.unlockAudioContext?.();

        // Intro music sequence
        await window.DrColiAudio?.playIntroSequence?.({ holdMs: 2000, fadeMs: 900 });

        // Hide start screen
        if (startScreenEl) startScreenEl.style.display = "none";

        // Now allow lesson start
        introSequenceDone = true;

        // Show mission bar once lesson begins
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

    if (el) {
      el.textContent = "⭐";
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
      setTimeout(() => el.classList.remove("pop"), 260);
    }

    if (missionTextEl) {
      if (missionTextTimer) clearTimeout(missionTextTimer);

      if (starsEarned === 5) {
        missionTextEl.textContent = "⭐⭐⭐⭐⭐ Bori is ready!";
      } else {
        missionTextEl.textContent = `⭐ Star earned! (${starsEarned}/5)`;
        missionTextTimer = setTimeout(() => {
          missionTextEl.textContent = "Collect 5 stars to help Bori!";
        }, 1200);
      }
    }
  }


  async function boot() {
    initPixi();

    if (PIXI.Assets?.init) {
      await PIXI.Assets.init({ manifest: null }).catch(() => {});
    }

    const [ep, man] = await Promise.all([
      fetchJSON(EPISODE_URL),
      fetchJSON(CHARACTER_MANIFEST_URL),
    ]);

    episodeData = ep;
    characterManifest = normalizeManifest(man);

    await Promise.all([
      ensureStateLoaded("drColi", "idle"),
      ensureStateLoaded("bori", "idle"),
      ensureStateLoaded("drColi", "talk").catch(() => {}),
      ensureStateLoaded("bori", "look").catch(() => {}),
    ]);

    createCharacters();
    assetsReadyToStart = true;

    // Enable Start button now that Dr. Coli + Bori are ready
    if (startButtonEl) {
      startButtonEl.disabled = false;
      startButtonEl.textContent = "Let's start!";
    }

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

  // iOS Safari: make sure the canvas actually fills the stage container
  try {
    pixiApp.view.style.width = "100%";
    pixiApp.view.style.height = "100%";
    pixiApp.view.style.display = "block";
  } catch {}

  const doResize = () => {
    try {
      if (!pixiApp || !stageLayerEl) return;

      const rect = stageLayerEl.getBoundingClientRect();

      // iOS Safari can report a temporary tiny size during UI/layout shifts (mic permission bar, address bar).
      // If we resize to ~1px we can push characters off-screen. Skip and retry shortly.
      if (rect.width < 200 || rect.height < 200) {
        setTimeout(() => requestAnimationFrame(doResize), 140);
        return;
      }

      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));

      // Even though resizeTo is set, iOS Safari sometimes needs an explicit resize.
      pixiApp.renderer.resize(w, h);

      // Keep characters grounded after any resize/layout shift
      positionCharacters();
    } catch (e) {
      console.warn("Pixi resize failed:", e);
    }
  };

  // Re-size on common iOS layout shifts (address bar / orientation / keyboard)
  window.addEventListener("resize", () => requestAnimationFrame(doResize));
  window.addEventListener("orientationchange", () => setTimeout(doResize, 250));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => setTimeout(doResize, 60));
    window.visualViewport.addEventListener("scroll", () => setTimeout(doResize, 60));
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(doResize, 200);
  });

  // WebGL context loss safety (rare, but happens on iPad)
  const canvas = pixiApp.view;
  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      console.warn("WebGL context lost");
    },
    false
  );
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      console.warn("WebGL context restored");
      setTimeout(doResize, 120);
    },
    false
  );

  // Initial layout
  setTimeout(doResize, 0);
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

    const margin = clamp(h * 0.016, 10, 22);
    const groundY = h - margin;

    const gap = clamp(w * 0.18, 140, 360);
    const cx = w * 0.5;

    drColiSprite.x = cx - gap / 2;
    boriSprite.x = cx + gap / 2;

    drColiSprite.y = groundY + 0;
    boriSprite.y = groundY + 10;
  }


  function resizePixiNow() {
    try {
      if (!pixiApp || !stageLayerEl) return;
      const rect = stageLayerEl.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      pixiApp.renderer.resize(w, h);
      positionCharacters();
    } catch (e) {
      console.warn(\"resizePixiNow failed:\", e);
    }
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

    const themeBg = THEME_BG[selectedTheme] || DEFAULT_BG;
    setBackground(scene.background || themeBg);

    setDrColi(scene.drColi?.animation || "idle").catch(() => {});
    setBori(scene.bori?.animation || "idle").catch(() => {});

    const lines = scene.drColi?.say || [];
    playDialogue(lines, () =>
      enableInteraction(scene.interaction || { type: "none" })
    );
  }

  async function waitForUserInteraction() {
    if (userInteracted) return;
    if (unlockPromise) await unlockPromise;
  }


// ===== iOS Safari audio stability helpers =====
let tapToContinueEl = null;

function showTapToContinue(message = "Tap to continue 🔊") {
  if (tapToContinueEl) return;
  const ui = document.getElementById("uiLayer") || document.body;

  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.display = "grid";
  el.style.placeItems = "center";
  el.style.background = "rgba(0,0,0,0.35)";
  el.style.zIndex = "9999";
  el.style.pointerEvents = "auto";

  el.innerHTML = `
    <div style="
      background: rgba(255,255,255,0.92);
      color:#222;
      padding: 14px 18px;
      border-radius: 18px;
      font-weight: 900;
      font-size: 18px;
      box-shadow: 0 10px 24px rgba(0,0,0,0.20);
      text-align:center;
      max-width: 320px;
    ">
      ${message}
    </div>
  `;

  tapToContinueEl = el;
  ui.appendChild(el);
}

function hideTapToContinue() {
  if (!tapToContinueEl) return;
  tapToContinueEl.remove();
  tapToContinueEl = null;
}

async function requireTapToContinue(message) {
  showTapToContinue(message);
  return await new Promise((resolve) => {
    const handler = async () => {
      try {
        userInteracted = true;
        if (resolveUnlock) resolveUnlock();
        await window.DrColiAudio?.unlockAudioContext?.();
      } catch {}
      hideTapToContinue();
      window.removeEventListener("pointerdown", handler);
      resolve();
    };
    window.addEventListener("pointerdown", handler, { once: true });
  });
}

async function speakLine(text) {
  await waitForUserInteraction();
  const msg = personalizeText(text);

  // iOS Safari sometimes blocks/interrupts audio playback.
  // DrColiAudio.speakElevenLabs may resolve even if playback didn't actually happen,
  // so we use a conservative "expected minimum time" based on message length.
  const start = performance.now();

  const expectedMinMs = (() => {
    const len = (msg || "").length;
    // Base + per-char, clamped. (Kids TTS should never be "instant")
    return Math.max(650, Math.min(2600, 520 + len * 24));
  })();

  try {
    await window.DrColiAudio?.speakElevenLabs?.(msg, { rate: TTS_RATE });
    const dt = performance.now() - start;

    // If it returned too quickly, assume audio didn't actually play.
    if (dt < expectedMinMs && msg && msg.length > 3) {
      await requireTapToContinue("Tap to continue 🔊");
      await window.DrColiAudio?.speakElevenLabs?.(msg, { rate: TTS_RATE });
    }
  } catch (e) {
    console.warn("speakLine failed; waiting for tap to re-unlock audio:", e);
    await requireTapToContinue("Tap to continue 🔊");
    await window.DrColiAudio?.speakElevenLabs?.(msg, { rate: TTS_RATE });
  }
}

async function playDialogue(lines, done) {
    if (!lines || lines.length === 0) {
      hideDialogue();
      done?.();
      return;
    }
    showDialogue();

    for (const line of lines) {
      const msg = personalizeText(String(line ?? "").trim());
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
    if (missionBarEl) missionBarEl.classList.add("active");
  }

  function hideDialogue() {
    dialogueEl.classList.remove("active");
    dialogueTextEl.textContent = "";
    if (missionBarEl) missionBarEl.classList.remove("active");
  }

  function setDialogueText(text) {
    const msg = personalizeText(text);
    dialogueTextEl.textContent = msg;
    return msg;
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
          const wrongLine =
            interaction.onWrongSay?.[0] || "Nice try! Let’s try again.";
          dialogueEl.classList.add("active");
          setDialogueText(wrongLine);
          await speakLine(wrongLine);
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

    const promptText = personalizeText(prompt);

    micButtonEl.classList.remove("hidden");
    micButtonEl.classList.remove("listening");
    micButtonEl.classList.remove("processing");
    micButtonEl.classList.add("attention");
    micButtonEl.disabled = true;

    dialogueEl.classList.add("active");
    dialogueTextEl.textContent = promptText;

    window.DrColiAudio?.playSfx?.("mic");

    (async () => {
      try {
        await setDrColi("talk").catch(() => {});
        await speakLine(promptText);
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

        // iOS Safari can shift layout after mic permission/recording; re-ground sprites.
        try { resizePixiNow(); } catch {}

        if (myRun !== sceneRunId) return;

        micButtonEl.classList.remove("listening");

        if (!speechStarted) {
          const silentLine = "Hmm… I didn’t hear anything. Let’s try again!";
          dialogueEl.classList.add("active");
          const msg = setDialogueText(silentLine);
          await setDrColi("talk").catch(() => {});
          await speakLine(msg);
          await setDrColi("idle").catch(() => {});
          if (myRun !== sceneRunId) return;

          micButtonEl.disabled = false;
          micButtonEl.classList.add("attention");
          return;
        }

        const checkPromise = listenAndCheckPhrase(targets, strictness, blob);

        micButtonEl.classList.add("processing");
        dialogueEl.classList.add("active");
        const oneMomentLine = setDialogueText("One moment!");

        await setDrColi("talk").catch(() => {});
        const oneMomentPromise = speakLine(oneMomentLine);
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
          const msg = setDialogueText(failLine);
          await setDrColi("talk").catch(() => {});
          await speakLine(msg);
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

  
  function pickBestRecorderMimeType() {
    try {
      const MR = window.MediaRecorder;
      if (!MR || typeof MR.isTypeSupported !== "function") return "";
      const candidates = [
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/aac",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      for (const t of candidates) {
        if (MR.isTypeSupported(t)) return t;
      }
      return "";
    } catch {
      return "";
    }
  }

  function filenameForMime(mime) {
    const m = (mime || "").toLowerCase();
    if (m.includes("mp4") || m.includes("m4a")) return "speech.m4a";
    if (m.includes("aac")) return "speech.aac";
    if (m.includes("webm")) return "speech.webm";
    return "speech.webm";
  }

async function recordOnce({ ms = 2600 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMime = pickBestRecorderMimeType();
    const rec = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
    const chunks = [];

    return await new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onerror = (e) => reject(e.error || e);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: (preferredMime || rec.mimeType || "audio/webm") }));
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
    const preferredMime = pickBestRecorderMimeType();
    const rec = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
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
          resolve(new Blob(chunks, { type: (preferredMime || rec.mimeType || "audio/webm") }));
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
    fd.append("file", blob, filenameForMime(blob?.type || ""));
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

    window.DrColiAudio?.playSfx?.("correct");
    setTimeout(() => window.DrColiAudio?.playSfx?.("kids"), 150);

    spawnFullScreenConfetti();

    const lines = Array.isArray(praiseLines)
      ? praiseLines.map((x) => String(x || "").trim()).filter(Boolean)
      : [String(praiseLines || "").trim()].filter(Boolean);

    for (const line of lines) {
      dialogueEl.classList.add("active");
      const msg = setDialogueText(line);
      await speakLine(msg);
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
})();
