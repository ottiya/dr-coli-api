/* public/v2/v2.js */
/* Pixi v7-safe + guarded against double-boot + non-fatal spritesheet loading */

(() => {
  if (window.__DRCOLI_V2_BOOTED__) return;
  window.__DRCOLI_V2_BOOTED__ = true;

  // ===== Game state =====
  let currentSceneIndex = 0;
  let episodeData = null;

  const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
  const EPISODE_URL = "/lessons/episode-01.json";
  const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

  // ===== DOM refs =====
  let bgLayer, dialogueEl, dialogueTextEl, emojiTrayEl, micButtonEl, fxLayerEl, stageLayerEl;

  // ===== Pixi =====
  let pixiApp = null;
  let drColiSprite = null;
  let boriSprite = null;

  const textureCache = { drColi: {}, bori: {} };
  const charState = { drColi: "idle", bori: "idle" };

  document.addEventListener("DOMContentLoaded", () => {
    bgLayer = document.getElementById("bgLayer");
    dialogueEl = document.getElementById("dialogue");
    dialogueTextEl = document.getElementById("dialogueText");
    emojiTrayEl = document.getElementById("emojiTray");
    micButtonEl = document.getElementById("micButton");
    fxLayerEl = document.getElementById("fxLayer");
    stageLayerEl = document.getElementById("stageLayer");

    if (!bgLayer || !dialogueEl || !dialogueTextEl || !emojiTrayEl || !micButtonEl || !fxLayerEl || !stageLayerEl) {
      console.error("Missing required DOM elements. Check index.html for: bgLayer, stageLayer, ui elements.");
      return;
    }

    boot().catch(err => console.error("BOOT ERROR:", err));
  });

  async function boot() {
    setBackground(DEFAULT_BG);
    initPixi();

    if (PIXI.Assets?.init) {
      await PIXI.Assets.init({ manifest: null }).catch(() => {});
    }

    // Load character textures but do NOT hard-fail if some sheets are missing
    const manifest = await fetchJSON(CHARACTER_MANIFEST_URL);
    await loadCharacterTextures(manifest);

    createCharacters();

    episodeData = await fetchJSON(EPISODE_URL);
    playScene(0);
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

  function initPixi() {
    pixiApp = new PIXI.Application({
      backgroundAlpha: 0,
      resizeTo: stageLayerEl,
      antialias: true
    });

    stageLayerEl.appendChild(pixiApp.view);
    window.addEventListener("resize", positionCharacters);
  }

  // ===== Loading textures (non-fatal) =====
  async function loadCharacterTextures(manifest) {
    await loadCharacterFromManifest("drColi", manifest?.drColi);
    await loadCharacterFromManifest("bori", manifest?.bori);
  }

  async function loadCharacterFromManifest(characterKey, statesObj) {
    if (!statesObj) {
      console.warn(`[manifest] Missing states for ${characterKey}`);
      return;
    }

    for (const [stateName, jsonUrls] of Object.entries(statesObj)) {
      const textures = [];

      for (const jsonUrl of (jsonUrls || [])) {
        const sheetTextures = await loadSpritesheetTexturesSafe(jsonUrl, `${characterKey}.${stateName}`);
        textures.push(...sheetTextures);
      }

      textureCache[characterKey][stateName] = textures;
    }
  }

 async function loadSpritesheetTexturesSafe(jsonUrl, label) {
  try {
    // --- Prevent duplicate texture cache warnings ---
    const originalAdd = PIXI.Texture.addToCache;
    const originalRemove = PIXI.Texture.removeFromCache;

    // Temporarily disable global texture cache writes
    PIXI.Texture.addToCache = () => {};
    PIXI.Texture.removeFromCache = () => {};

    const loaded = await PIXI.Assets.load(jsonUrl);

    // Restore cache functions immediately after load
    PIXI.Texture.addToCache = originalAdd;
    PIXI.Texture.removeFromCache = originalRemove;

    const sheet =
      loaded?.textures
        ? loaded
        : loaded?.spritesheet?.textures
        ? loaded.spritesheet
        : null;

    if (!sheet || !sheet.textures) {
      console.warn(`[sheet] No textures found for ${label}: ${jsonUrl}`);
      return [];
    }

    // Stable order
    const keys = Object.keys(sheet.textures).sort();
    return keys.map(k => sheet.textures[k]);

  } catch (err) {
    console.error(`[sheet] Failed to load ${label}: ${jsonUrl}`, err);
    return [];
  }
}

  // ===== Create & place characters =====
  function createCharacters() {
    const drIdle = textureCache.drColi.idle || [];
    const boriIdle = textureCache.bori.idle || [];

    // If missing, still create sprite so stage renders
    drColiSprite = new PIXI.AnimatedSprite(drIdle.length ? drIdle : [PIXI.Texture.WHITE]);
    boriSprite = new PIXI.AnimatedSprite(boriIdle.length ? boriIdle : [PIXI.Texture.WHITE]);

    drColiSprite.anchor.set(0.5, 1);
    boriSprite.anchor.set(0.5, 1);

    drColiSprite.scale.set(0.55);
    boriSprite.scale.set(0.55);

    pixiApp.stage.addChild(drColiSprite);
    pixiApp.stage.addChild(boriSprite);

    positionCharacters();

    setDrColi("idle");
    setBori("idle");
  }

  function positionCharacters() {
    if (!pixiApp || !drColiSprite || !boriSprite) return;

    const w = pixiApp.renderer.width;
    const h = pixiApp.renderer.height;
    const groundY = h - 40;

    drColiSprite.x = w * 0.25;
    drColiSprite.y = groundY;

    boriSprite.x = w * 0.62;
    boriSprite.y = groundY;
  }

  function setDrColi(state, opts = {}) {
    charState.drColi = state;
    playCharacterState(drColiSprite, textureCache.drColi[state], { pingpong: shouldPingPong(state), ...opts });
  }

  function setBori(state, opts = {}) {
    charState.bori = state;
    playCharacterState(boriSprite, textureCache.bori[state], { pingpong: shouldPingPong(state), ...opts });
  }

  function shouldPingPong(state) {
    return state === "idle" || state === "look" || state === "talk";
  }

  function playCharacterState(sprite, textures, { pingpong = false, once = false, speed = 0.12 } = {}) {
    if (!sprite) return;

    if (!textures || textures.length === 0) {
      // Keep whatever it currently has (or WHITE)
      sprite.animationSpeed = 0;
      sprite.stop();
      return;
    }

    sprite.textures = textures;
    sprite.animationSpeed = Math.abs(speed);

    if (pingpong && textures.length > 1) {
      sprite.loop = false;
      sprite.gotoAndPlay(0);

      sprite.onComplete = () => {
        sprite.animationSpeed *= -1;
        if (sprite.currentFrame === textures.length - 1) sprite.gotoAndPlay(textures.length - 1);
        else sprite.gotoAndPlay(0);
      };
    } else {
      sprite.onComplete = null;
      sprite.loop = !once;
      sprite.gotoAndPlay(0);
    }
  }

  // ===== Scene engine =====
  function playScene(index) {
    currentSceneIndex = index;

    if (!episodeData?.scenes?.[index]) {
      console.log("Episode finished or scene missing:", index);
      return;
    }

    const scene = episodeData.scenes[index];

    setBackground(scene.background || episodeData.background || DEFAULT_BG);

    const drAnim = scene.drColi?.animation || "idle";
    const boriAnim = scene.bori?.animation || null;

    if (drAnim === "bow" || boriAnim === "bow") {
      setDrColi("bow", { speed: 0.12 });
      setBori("bow", { speed: 0.12 });
    } else {
      setDrColi(drAnim);

      if (boriAnim) setBori(boriAnim);
      else setBori(drAnim === "wave" ? "idle" : "look");
    }

    const lines = scene.drColi?.say || [];
    playDialogue(lines, () => enableInteraction(scene.interaction || { type: "none" }));
  }

  async function playDialogue(lines, done) {
    if (!lines || lines.length === 0) {
      dialogueEl.classList.remove("active");
      dialogueTextEl.textContent = "";
      return done?.();
    }

    dialogueEl.classList.add("active");

    for (const line of lines) {
      dialogueTextEl.textContent = line;
      await speakLine(line);
      await sleep(200);
    }

    done?.();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function speakLine(text) {
    try {
      const res = await fetch("/api/tts-elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        console.warn("ElevenLabs TTS error:", res.status);
        return;
      }

      const data = await res.json();
      const url = data?.url;
      if (!url) return;

      const audio = new Audio(url);
      audio.playbackRate = 1.1;
      await audio.play();

      await new Promise(resolve => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch (err) {
      console.warn("TTS playback failed (non-fatal):", err);
    }
  }

  function enableInteraction(interaction) {
    const type = interaction?.type || "none";

    emojiTrayEl.classList.add("hidden");
    emojiTrayEl.classList.remove("active");
    micButtonEl.classList.add("hidden");

    if (type === "none") return autoAdvance();
    if (type === "emoji") return showEmojiInteraction(interaction);
    if (type === "mic") return showMicInteraction(interaction);

    autoAdvance();
  }

  function autoAdvance() {
    setTimeout(() => playScene(currentSceneIndex + 1), 500);
  }

  function showEmojiInteraction(interaction) {
    const choices = interaction.choices || [];
    const correctIndex = interaction.correctIndex ?? 0;

    emojiTrayEl.classList.remove("hidden");
    requestAnimationFrame(() => emojiTrayEl.classList.add("active"));

    const buttons = emojiTrayEl.querySelectorAll(".emoji-slot");
    buttons.forEach((btn, i) => {
      btn.textContent = choices[i] || "";
      btn.onclick = async () => {
        if (i === correctIndex) {
          await celebrateCorrect(interaction.onCorrectSay?.[0] || "Yes! Amazing job!");
          emojiTrayEl.classList.remove("active");
          setTimeout(() => {
            emojiTrayEl.classList.add("hidden");
            playScene(currentSceneIndex + 1);
          }, 300);
        } else {
          setDrColi("idle");
          setBori("idle");
          const msg = interaction.onWrongSay?.[0] || "So close! Let’s try again.";
          await speakLine(msg);
        }
      };
    });
  }

  function showMicInteraction(interaction) {
    micButtonEl.classList.remove("hidden");
    micButtonEl.onclick = async () => {
      micButtonEl.classList.add("hidden");
      playScene(currentSceneIndex + 1);
    };
  }

  async function celebrateCorrect(praiseLine) {
    const prevDr = charState.drColi;
    const prevBori = charState.bori;

    setDrColi("wave", { speed: 0.14 });
    setBori("wave", { speed: 0.14 });

    spawnFullScreenConfetti();
    await speakLine(praiseLine);

    setDrColi(prevDr);
    setBori(prevBori);
  }

  function spawnFullScreenConfetti() {
    // no-op
  }
})();
