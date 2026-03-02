/* public/v2/v2.js */

let currentSceneIndex = 0;
let episodeData = null;

const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
const EPISODE_URL = "/lessons/episode-01.json";
const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

// ===== DOM refs (assigned after DOMContentLoaded) =====
let bgLayer, dialogueEl, dialogueTextEl, emojiTrayEl, micButtonEl, fxLayerEl, stageLayerEl;

// ===== Pixi =====
let pixiApp = null;
let drColiSprite = null;
let boriSprite = null;

// Cache: character -> state -> textures[]
const textureCache = {
  drColi: {},
  bori: {}
};

// Track current states so we can restore after celebrations
const charState = {
  drColi: "idle",
  bori: "idle"
};

// ===== Boot safely after DOM is ready =====
document.addEventListener("DOMContentLoaded", () => {
  // DOM refs
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
  // Default bg immediately (prevents black screen)
  setBackground(DEFAULT_BG);

  // Init Pixi stage
  initPixi();

  // Load character textures (Pixi v7 loader flow)
  const manifest = await fetchJSON(CHARACTER_MANIFEST_URL);
  await loadCharacterTextures(manifest);

  // Create character sprites
  createCharacters();

  // Load episode
  episodeData = await fetchJSON(EPISODE_URL);

  // Start
  playScene(0);
}

// ===== Helpers =====
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
  // Pixi v7 style:
  pixiApp = new PIXI.Application({
    backgroundAlpha: 0,
    resizeTo: stageLayerEl,
    antialias: true
  });

  stageLayerEl.appendChild(pixiApp.view);

  window.addEventListener("resize", () => {
    positionCharacters();
  });
}

// ===== Load sprite sheets from manifest (Pixi v7 Loader) =====
async function loadCharacterTextures(manifest) {
  await loadCharacterFromManifest("drColi", manifest.drColi);
  await loadCharacterFromManifest("bori", manifest.bori);
}

function loaderAddUnique(loader, url) {
  if (!loader.resources[url]) loader.add(url);
}

async function loadCharacterFromManifest(characterKey, statesObj) {
  for (const [stateName, jsonUrls] of Object.entries(statesObj)) {
    const textures = [];

    for (const jsonUrl of jsonUrls) {
      const sheetTextures = await loadSpritesheetTextures(jsonUrl);
      textures.push(...sheetTextures);
    }

    textureCache[characterKey][stateName] = textures;
  }
}

function loadSpritesheetTextures(jsonUrl) {
  return new Promise((resolve, reject) => {
    const loader = new PIXI.Loader();

    loaderAddUnique(loader, jsonUrl);

    loader.load((_, resources) => {
      const res = resources[jsonUrl];
      if (!res) return reject(new Error(`Loader missing resource: ${jsonUrl}`));

      // TexturePacker JSON normally produces a Spritesheet in res.spritesheet
      const sheet = res.spritesheet;
      if (!sheet || !sheet.textures) {
        return reject(new Error(`No spritesheet/textures found in: ${jsonUrl}`));
      }

      // Stable frame order
      const keys = Object.keys(sheet.textures).sort();
      const textures = keys.map(k => sheet.textures[k]);
      resolve(textures);
    });

    loader.onError.add((e) => reject(e));
  });
}

// ===== Create & place characters =====
function createCharacters() {
  const drIdle = textureCache.drColi.idle || [];
  const boriIdle = textureCache.bori.idle || [];

  if (!drIdle.length) console.warn("Dr. Coli idle textures missing");
  if (!boriIdle.length) console.warn("Bori idle textures missing");

  drColiSprite = new PIXI.AnimatedSprite(drIdle.length ? drIdle : [PIXI.Texture.WHITE]);
  boriSprite = new PIXI.AnimatedSprite(boriIdle.length ? boriIdle : [PIXI.Texture.WHITE]);

  // Anchor bottom-center for easy ground placement
  drColiSprite.anchor.set(0.5, 1);
  boriSprite.anchor.set(0.5, 1);

  // Sizing: tweak to taste
  drColiSprite.scale.set(0.55);
  boriSprite.scale.set(0.55);

  pixiApp.stage.addChild(drColiSprite);
  pixiApp.stage.addChild(boriSprite);

  positionCharacters();

  // Start idle ping-pong
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

// ===== Character state setters (with ping-pong option) =====
function setDrColi(state, opts = {}) {
  charState.drColi = state;
  playCharacterState(drColiSprite, textureCache.drColi[state], {
    pingpong: shouldPingPong(state),
    ...opts
  });
}

function setBori(state, opts = {}) {
  charState.bori = state;
  playCharacterState(boriSprite, textureCache.bori[state], {
    pingpong: shouldPingPong(state),
    ...opts
  });
}

function shouldPingPong(state) {
  // Smooth “breathing” states
  return state === "idle" || state === "look" || state === "talk";
}

function playCharacterState(sprite, textures, { pingpong = false, once = false, speed = 0.12 } = {}) {
  if (!sprite || !textures || textures.length === 0) return;

  sprite.textures = textures;
  sprite.animationSpeed = Math.abs(speed);

  if (pingpong && textures.length > 1) {
    // Ping-pong by flipping direction at ends
    sprite.loop = false;
    sprite.gotoAndPlay(0);

    sprite.onComplete = () => {
      sprite.animationSpeed *= -1;

      if (sprite.currentFrame === textures.length - 1) {
        sprite.gotoAndPlay(textures.length - 1);
      } else {
        sprite.gotoAndPlay(0);
      }
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

  if (!episodeData || !episodeData.scenes || !episodeData.scenes[index]) {
    console.log("Episode finished or scene missing:", index);
    return;
  }

  const scene = episodeData.scenes[index];

  // Background: scene override or episode default
  setBackground(scene.background || episodeData.background || DEFAULT_BG);

  // Character logic rules
  const drAnim = scene.drColi?.animation || "idle";
  const boriAnim = scene.bori?.animation || null;

  // If either is bow => both bow
  if (drAnim === "bow" || boriAnim === "bow") {
    setDrColi("bow", { speed: 0.12 });
    setBori("bow", { speed: 0.12 });
  } else {
    setDrColi(drAnim);

    if (boriAnim) {
      setBori(boriAnim);
    } else {
      // Dr wave => Bori calm idle; otherwise Bori looks
      if (drAnim === "wave") setBori("idle");
      else setBori("look");
    }
  }

  // Dialogue
  const lines = scene.drColi?.say || [];
  playDialogue(lines, () => {
    enableInteraction(scene.interaction || { type: "none" });
  });
}

// ===== Dialogue =====
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

// ===== TTS hook (ElevenLabs implementation) =====
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
    audio.playbackRate = 1.1; // slightly faster (tweak this if needed)
    await audio.play();

    // await playback fully
    await new Promise(resolve => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });

  } catch (err) {
    console.warn("TTS playback failed (non-fatal):", err);
  }
}
// ===== Interactions =====
function enableInteraction(interaction) {
  const type = interaction?.type || "none";

  // reset UI
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

// ===== Emoji interaction =====
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
        // Wrong answer -> calm down / reset
        setDrColi("idle");
        setBori("idle");

        const msg = interaction.onWrongSay?.[0] || "So close! Let’s try again.";
        await speakLine(msg);
      }
    };
  });
}

// ===== Mic interaction (tap-to-continue for now) =====
function showMicInteraction(interaction) {
  micButtonEl.classList.remove("hidden");
  micButtonEl.onclick = async () => {
    micButtonEl.classList.add("hidden");
    playScene(currentSceneIndex + 1);
  };
}

// ===== Celebration =====
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

// Placeholder (keep your existing confetti if already implemented elsewhere)
function spawnFullScreenConfetti() {
  // no-op
}
