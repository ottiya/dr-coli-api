/* v2.js */

let currentSceneIndex = 0;
let episodeData = null;

const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
const EPISODE_URL = "/lessons/episode-01.json";
const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

// ===== DOM refs =====
const bgLayer = document.getElementById("bgLayer");
const dialogueEl = document.getElementById("dialogue");
const dialogueTextEl = document.getElementById("dialogueText");
const emojiTrayEl = document.getElementById("emojiTray");
const micButtonEl = document.getElementById("micButton");
const fxLayerEl = document.getElementById("fxLayer");
const stageLayerEl = document.getElementById("stageLayer");

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

// ===== Boot =====
boot().catch(err => {
  console.error("BOOT ERROR:", err);
});

async function boot() {
  // Default bg immediately (prevents black screen)
  setBackground(DEFAULT_BG);

  // Init Pixi stage
  initPixi();

  // Load character textures
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return await res.json();
}

function setBackground(bgFileOrUrl) {
  const url = bgFileOrUrl.startsWith("http") || bgFileOrUrl.startsWith("/")
    ? bgFileOrUrl
    : `/assets/backgrounds/${bgFileOrUrl}`;

  bgLayer.style.backgroundImage = `url("${url}")`;
}

function initPixi() {
  pixiApp = new PIXI.Application();
  // Let Pixi size itself to the stageLayer box (which is 16:9 already)
  pixiApp.init({
    backgroundAlpha: 0,
    resizeTo: stageLayerEl,
    antialias: true
  });

  stageLayerEl.appendChild(pixiApp.canvas);

  // Reposition characters whenever viewport changes
  window.addEventListener("resize", () => {
    positionCharacters();
  });
}

// ===== Load sprite sheets from manifest =====
async function loadCharacterTextures(manifest) {
  // Pixi v8: use PIXI.Assets.load for each spritesheet JSON
  await loadCharacterFromManifest("drColi", manifest.drColi);
  await loadCharacterFromManifest("bori", manifest.bori);
}

async function loadCharacterFromManifest(characterKey, statesObj) {
  for (const [stateName, jsonUrls] of Object.entries(statesObj)) {
    const textures = [];

    for (const jsonUrl of jsonUrls) {
      // Pixi will auto-load the PNG referenced by the JSON
      const sheet = await PIXI.Assets.load(jsonUrl);

      // sheet.textures is a map of frameName -> Texture
      // We sort keys for stable animation order
      const keys = Object.keys(sheet.textures).sort();
      for (const k of keys) textures.push(sheet.textures[k]);
    }

    textureCache[characterKey][stateName] = textures;
  }
}

// ===== Create & place characters =====
function createCharacters() {
  drColiSprite = new PIXI.AnimatedSprite(textureCache.drColi.idle);
  boriSprite = new PIXI.AnimatedSprite(textureCache.bori.idle);

  // Anchor bottom-center for easy ground placement
  drColiSprite.anchor.set(0.5, 1);
  boriSprite.anchor.set(0.5, 1);

  // Sizing: scale relative to stage height
  // tweak these to taste
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

  // “Ground” line (a little above bottom so they don't clip)
  const groundY = h - 40;

  // left + right spacing
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
  sprite.animationSpeed = speed;

  if (pingpong && textures.length > 1) {
    // Ping-pong by reversing direction at ends
    sprite.loop = false;
    sprite.gotoAndPlay(0);

    sprite.onComplete = () => {
      // flip direction
      sprite.animationSpeed *= -1;

      // if we ended at last frame going forward, play back; if at first frame going backward, play forward
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
    console.error("Scene not found:", index);
    return;
  }

  const scene = episodeData.scenes[index];

  // Background: scene override or episode default
  setBackground(scene.background || episodeData.background || DEFAULT_BG);

  // Character logic rules:
  // 1) If either is bow => both bow
  const drAnim = scene.drColi?.animation || "idle";
  const boriAnim = scene.bori?.animation || null;

  if (drAnim === "bow" || boriAnim === "bow") {
    setDrColi("bow", { speed: 0.12 });
    setBori("bow", { speed: 0.12 });
  } else {
    setDrColi(drAnim);

    // If scene doesn't specify bori, choose a “supporting” default
    if (boriAnim) {
      setBori(boriAnim);
    } else {
      // If Dr. Coli is waving/excited, keep Bori calm idle (your preference)
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

// ===== Dialogue (simple, uses your existing UI bubble) =====
async function playDialogue(lines, done) {
  if (!lines || lines.length === 0) {
    dialogueEl.classList.remove("active");
    dialogueTextEl.textContent = "";
    return done?.();
  }

  dialogueEl.classList.add("active");

  for (const line of lines) {
    dialogueTextEl.textContent = line;

    // If you already have your TTS function, keep using it.
    // This is intentionally minimal so you can plug in your current audio flow.
    await speakLine(line);

    // tiny pause between lines
    await sleep(200);
  }

  done?.();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ===== TTS hook (KEEP yours if it already works) =====
async function speakLine(text) {
  // If your existing v2.js already does TTS, keep that code.
  // This placeholder tries OpenAI TTS endpoint you already had:
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!r.ok) return;

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audio.playbackRate = 1.05; // slightly faster (tweak this)
    await audio.play();

    await new Promise(resolve => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
    });
  } catch (e) {
    console.warn("TTS failed (non-fatal):", e);
  }
}

// ===== Interactions =====
function enableInteraction(interaction) {
  const type = interaction?.type || "none";

  // reset UI
  emojiTrayEl.classList.add("hidden");
  emojiTrayEl.classList.remove("active");
  micButtonEl.classList.add("hidden");

  if (type === "none") {
    return autoAdvance();
  }

  if (type === "emoji") {
    return showEmojiInteraction(interaction);
  }

  if (type === "mic") {
    return showMicInteraction(interaction);
  }

  autoAdvance();
}

function autoAdvance() {
  setTimeout(() => {
    playScene(currentSceneIndex + 1);
  }, 500);
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
        // Celebrate + voice line
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

// ===== Mic interaction (for now tap-to-continue; STT comes next) =====
function showMicInteraction(interaction) {
  micButtonEl.classList.remove("hidden");

  micButtonEl.onclick = async () => {
    // Later: start STT here, listen, grade, etc.
    // For now: just proceed
    micButtonEl.classList.add("hidden");

    // Optional: short “great try” line
    // await speakLine("Great job!");

    playScene(currentSceneIndex + 1);
  };
}

// ===== Celebration =====
async function celebrateCorrect(praiseLine) {
  // Your preference: wave when excited
  const prevDr = charState.drColi;
  const prevBori = charState.bori;

  setDrColi("wave", { speed: 0.14 });
  setBori("wave", { speed: 0.14 });

  spawnFullScreenConfetti();

  await speakLine(praiseLine);

  // return to previous states
  setDrColi(prevDr);
  setBori(prevBori);
}

// If your confetti is already “beautiful”, keep your current confetti code.
// This is just a safe placeholder that doesn’t break anything.
function spawnFullScreenConfetti() {
  // no-op here if you already implemented confetti elsewhere
}
