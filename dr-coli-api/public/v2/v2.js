/* public/v2/v2.js */
/* Pixi v7 + lazy-load sheets + ElevenLabs TTS + OpenAI STT mic check (kid-forgiving) */

(() => {
  if (window.__DRCOLI_V2_BOOTED__) return;
  window.__DRCOLI_V2_BOOTED__ = true;

  // ===== Constants =====
  const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
  const EPISODE_URL = "/lessons/episode-01.json";
  const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

  // TTS tuning
  const TTS_RATE = 1.25;           // faster speaking
  const BETWEEN_LINES_MS = 80;     // less delay between lines

  // STT tuning
  const STT_MODEL = "gpt-4o-mini-transcribe"; // or "gpt-4o-transcribe"
  const STT_LANGUAGE = "ko";

  // ===== Game state =====
  let currentSceneIndex = 0;
  let episodeData = null;
  let characterManifest = null;

  // ===== DOM refs =====
  let bgLayer, dialogueEl, dialogueTextEl, emojiTrayEl, micButtonEl, fxLayerEl, stageLayerEl;

  // ===== Pixi =====
  let pixiApp = null;
  let drColiSprite = null;
  let boriSprite = null;

  // Cache: character -> state -> textures[]
  const textureCache = { drColi: {}, bori: {} };
  const charState = { drColi: "idle", bori: "idle" };

  // Audio unlock gate
  let userInteracted = false;
  let unlockPromise = null;

  document.addEventListener("DOMContentLoaded", () => {
    bgLayer = document.getElementById("bgLayer");
    dialogueEl = document.getElementById("dialogue");
    dialogueTextEl = document.getElementById("dialogueText");
    emojiTrayEl = document.getElementById("emojiTray");
    micButtonEl = document.getElementById("micButton");
    fxLayerEl = document.getElementById("fxLayer");
    stageLayerEl = document.getElementById("stageLayer");

    if (!bgLayer || !dialogueEl || !dialogueTextEl || !emojiTrayEl || !micButtonEl || !fxLayerEl || !stageLayerEl) {
      console.error("Missing required DOM elements. Check index.html for: bgLayer, stageLayer, UI elements.");
      return;
    }

    applyDialogueLayoutFix();
    ensureStartOverlay();

    boot().catch(err => console.error("BOOT ERROR:", err));
  });

  async function boot() {
    setBackground(DEFAULT_BG);
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

    // Support either:
    // { drColi: {...}, bori: {...} } OR { "drColi": {...}, "bori": {...} } OR { drColi:... } etc.
    characterManifest = normalizeManifest(man);

    // Fast boot: load minimum states only
    await Promise.all([
      ensureStateLoaded("drColi", "idle"),
      ensureStateLoaded("bori", "idle"),
      // prewarm common ones (optional)
      ensureStateLoaded("drColi", "talk").catch(() => {}),
      ensureStateLoaded("bori", "look").catch(() => {}),
    ]);

    createCharacters();
    playScene(0);
  }

  function normalizeManifest(man) {
    // If someone wraps inside { drColi: ..., bori: ... } we're good.
    // If it’s { "drColi":..., "bori":... } we're good.
    // If it's { "DrColi":... } etc, we fallback with best effort.
    const out = { drColi: null, bori: null };

    out.drColi = man?.drColi || man?.DrColi || man?.drcoli || man?.["dr-coli"] || man?.["dr_coli"] || null;
    out.bori = man?.bori || man?.Bori || null;

    // If it's already {drColi:{...}, bori:{...}} keep as is
    if (man?.drColi && man?.bori) return man;

    // If it has top-level keys that look correct, return original
    if (man?.drColi || man?.bori) return { drColi: out.drColi || man.drColi, bori: out.bori || man.bori };

    // Otherwise just return original and let ensureStateLoaded try direct access
    return man;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return await res.json();
  }

  // ===== UI layout fixes =====
  function applyDialogueLayoutFix() {
    // Move bubble near top so it doesn't cover characters
    dialogueEl.style.left = "50%";
    dialogueEl.style.transform = "translateX(-50%)";
    dialogueEl.style.top = "18px";
    dialogueEl.style.bottom = "auto";
    dialogueEl.style.width = "min(92vw, 900px)";
    dialogueEl.style.height = "auto";

    // Responsive text sizing
    dialogueTextEl.style.fontSize = "clamp(18px, 3.2vw, 38px)";
    dialogueTextEl.style.top = "22px";
    dialogueTextEl.style.left = "52px";
    dialogueTextEl.style.right = "52px";
  }

  // ===== Background =====
  function setBackground(bgFileOrUrl) {
    const url =
      bgFileOrUrl.startsWith("http") || bgFileOrUrl.startsWith("/")
        ? bgFileOrUrl
        : `/assets/backgrounds/${bgFileOrUrl}`;

    bgLayer.style.backgroundImage = `url("${url}")`;
  }

  // ===== Pixi init =====
  function initPixi() {
    pixiApp = new PIXI.Application({
      backgroundAlpha: 0,
      resizeTo: stageLayerEl,
      antialias: true,
    });

    stageLayerEl.appendChild(pixiApp.view);
    window.addEventListener("resize", positionCharacters);
  }

  // ===== Create & place characters =====
  function createCharacters() {
    const drIdle = textureCache.drColi.idle || [];
    const boriIdle = textureCache.bori.idle || [];

    drColiSprite = new PIXI.AnimatedSprite(drIdle.length ? drIdle : [PIXI.Texture.WHITE]);
    boriSprite = new PIXI.AnimatedSprite(boriIdle.length ? boriIdle : [PIXI.Texture.WHITE]);

    drColiSprite.anchor.set(0.5, 1);
    boriSprite.anchor.set(0.5, 1);

    pixiApp.stage.addChild(drColiSprite);
    pixiApp.stage.addChild(boriSprite);

    positionCharacters();

    // Start idle
    playCharacterState(drColiSprite, drIdle, { pingpong: true });
    playCharacterState(boriSprite, boriIdle, { pingpong: true });
  }

  function positionCharacters() {
    if (!pixiApp || !drColiSprite || !boriSprite) return;

    const w = pixiApp.renderer.width;
    const h = pixiApp.renderer.height;

    // scale down on small screens
    const scale = clamp(w / 1200, 0.33, 0.60);
    drColiSprite.scale.set(scale);
    boriSprite.scale.set(scale);

    // keep them side-by-side
    const groundY = h - clamp(h * 0.06, 24, 52);
    const gap = clamp(w * 0.18, 140, 360);
    const cx = w * 0.5;

    drColiSprite.x = cx - gap / 2;
    boriSprite.x = cx + gap / 2;

    drColiSprite.y = groundY;
    boriSprite.y = groundY;
  }

  // ===== State setters (lazy load on demand) =====
  async function setDrColi(state, opts = {}) {
    charState.drColi = state;
    await ensureStateLoaded("drColi", state);
    playCharacterState(drColiSprite, textureCache.drColi[state], { pingpong: shouldPingPong(state), ...opts });
  }

  async function setBori(state, opts = {}) {
    charState.bori = state;
    await ensureStateLoaded("bori", state);
    playCharacterState(boriSprite, textureCache.bori[state], { pingpong: shouldPingPong(state), ...opts });
  }

  function shouldPingPong(state) {
    return state === "idle" || state === "look" || state === "talk";
  }

  function playCharacterState(sprite, textures, { pingpong = false, once = false, speed = 0.13 } = {}) {
    if (!sprite) return;

    if (!textures || textures.length === 0) {
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

  // ===== Manifest-driven lazy loading =====
  async function ensureStateLoaded(characterKey, stateName) {
    if (textureCache[characterKey]?.[stateName]?.length) return;

    const entry = getManifestEntry(characterKey, stateName);
    if (!entry) {
      textureCache[characterKey][stateName] = [];
      return;
    }

    const jsonUrls = Array.isArray(entry) ? entry : [entry];
    const textures = [];

    for (const jsonUrl of jsonUrls) {
      const sheetTextures = await loadSpritesheetTexturesSafe(jsonUrl, `${characterKey}.${stateName}`);
      textures.push(...sheetTextures);
    }

    textureCache[characterKey][stateName] = textures;
  }

  function getManifestEntry(characterKey, stateName) {
    // try normalized manifest first
    const base = characterManifest?.[characterKey] || null;
    if (base && base[stateName]) return base[stateName];

    // fallback: try direct (if manifest itself is already {drColi:{...}})
    if (characterManifest?.drColi && characterKey === "drColi" && characterManifest.drColi[stateName]) {
      return characterManifest.drColi[stateName];
    }
    if (characterManifest?.bori && characterKey === "bori" && characterManifest.bori[stateName]) {
      return characterManifest.bori[stateName];
    }

    return null;
  }

  async function loadSpritesheetTexturesSafe(jsonUrl, label) {
    // Silence duplicate cache warnings for multipack sheets
    const originalAdd = PIXI.Texture.addToCache;
    const originalRemove = PIXI.Texture.removeFromCache;

    try {
      PIXI.Texture.addToCache = () => {};
      PIXI.Texture.removeFromCache = () => {};

      const loaded = await PIXI.Assets.load(jsonUrl);

      const sheet =
        loaded?.textures ? loaded :
        loaded?.spritesheet?.textures ? loaded.spritesheet :
        null;

      if (!sheet || !sheet.textures) {
        console.warn(`[sheet] No textures found for ${label}: ${jsonUrl}`);
        return [];
      }

      const keys = Object.keys(sheet.textures).sort();
      return keys.map(k => sheet.textures[k]);
    } catch (err) {
      console.error(`[sheet] Failed to load ${label}: ${jsonUrl}`, err);
      return [];
    } finally {
      PIXI.Texture.addToCache = originalAdd;
      PIXI.Texture.removeFromCache = originalRemove;
    }
  }

  // ===== Scene engine =====
  function playScene(index) {
    currentSceneIndex = index;

    const scene = episodeData?.scenes?.[index];
    if (!scene) {
      console.log("Episode finished or scene missing:", index);
      return;
    }

    setBackground(scene.background || episodeData.background || DEFAULT_BG);

    const drAnim = scene.drColi?.animation || "idle";
    const boriAnim = scene.bori?.animation || null;

    if (drAnim === "bow" || boriAnim === "bow") {
      setDrColi("bow").catch(() => {});
      setBori("bow").catch(() => {});
    } else {
      setDrColi(drAnim).catch(() => {});
      if (boriAnim) setBori(boriAnim).catch(() => {});
      else setBori(drAnim === "wave" ? "idle" : "look").catch(() => {});
    }

    const lines = scene.drColi?.say || [];
    playDialogue(lines, () => {
      enableInteraction(scene.interaction || { type: "none" });
    });
  }

  async function playDialogue(lines, done) {
    if (!lines || lines.length === 0) {
      dialogueEl.classList.remove("active");
      dialogueTextEl.textContent = "";
      done?.();
      return;
    }

    dialogueEl.classList.add("active");

    for (const line of lines) {
      dialogueTextEl.textContent = line;
      await speakLine(line);
      await sleep(BETWEEN_LINES_MS);
    }

    done?.();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===== Audio unlock overlay (fixes NotAllowedError) =====
  function ensureStartOverlay() {
    if (document.getElementById("startOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "startOverlay";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.zIndex = "9999";
    overlay.style.color = "#fff";
    overlay.style.fontFamily = "Nunito, system-ui, sans-serif";
    overlay.style.textAlign = "center";
    overlay.style.padding = "24px";
    overlay.innerHTML = `
      <div style="max-width: 520px;">
        <div style="font-size: 28px; font-weight: 800; margin-bottom: 10px;">Tap to start</div>
        <div style="font-size: 16px; opacity: 0.9;">This enables audio + microphone.</div>
      </div>
    `;

    overlay.addEventListener("pointerdown", async () => {
      userInteracted = true;
      overlay.remove();
      await unlockAudioContext();
    }, { once: true });

    document.body.appendChild(overlay);
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
    if (userInteracted) return;
    if (!unlockPromise) {
      ensureStartOverlay();
      unlockPromise = new Promise(resolve => {
        const handler = () => {
          userInteracted = true;
          window.removeEventListener("pointerdown", handler);
          resolve();
        };
        window.addEventListener("pointerdown", handler, { once: true });
      });
    }
    await unlockPromise;
  }

  // ===== ElevenLabs TTS =====
  async function speakLine(text) {
    try {
      await waitForUserInteraction();

      const res = await fetch("/api/tts-elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        console.warn("ElevenLabs TTS error:", res.status);
        return;
      }

      const data = await res.json();
      const url = data?.url;
      if (!url) return;

      const audio = new Audio(url);
      audio.playbackRate = TTS_RATE;

      await audio.play();
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

    emojiTrayEl.classList.add("hidden");
    emojiTrayEl.classList.remove("active");
    micButtonEl.classList.add("hidden");
    micButtonEl.onclick = null;

    if (type === "none") return autoAdvance();
    if (type === "emoji") return showEmojiInteraction(interaction);
    if (type === "mic") return showMicInteraction(interaction);

    autoAdvance();
  }

  function autoAdvance() {
    setTimeout(() => playScene(currentSceneIndex + 1), 350);
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
          await celebrateCorrect(interaction.onCorrectSay?.[0] || "Yes!! Amazing job!");
          emojiTrayEl.classList.remove("active");
          setTimeout(() => {
            emojiTrayEl.classList.add("hidden");
            playScene(currentSceneIndex + 1);
          }, 200);
        } else {
          await speakLine(interaction.onWrongSay?.[0] || "So close! Let’s try again.");
        }
      };
    });
  }

  // ===== Mic interaction (OpenAI STT + kid-forgiving) =====
  function showMicInteraction(interaction) {
    // We'll keep this generic for now. Later, when you share episode-01.json,
    // we can map exact fields.
    const target = (interaction.target || interaction.phrase || interaction.expected || "").trim();

    const prompt =
      interaction.prompt ||
      (target ? `Tap the mic, then say: ${target}` : "Tap the mic, then speak!");

    micButtonEl.classList.remove("hidden");

    // Show prompt in bubble (optional)
    dialogueEl.classList.add("active");
    dialogueTextEl.textContent = prompt;

    micButtonEl.onclick = async () => {
      await waitForUserInteraction();

      // visual feedback
      setDrColi("talk").catch(() => {});
      setBori("look").catch(() => {});

      const ok = await listenAndCheckPhrase(target);

      if (ok) {
        await celebrateCorrect(interaction.onSuccessSay?.[0] || interaction.onCorrectSay?.[0] || "Yes!! Amazing job!");
        micButtonEl.classList.add("hidden");
        playScene(currentSceneIndex + 1);
      } else {
        await speakLine(interaction.onFailSay?.[0] || interaction.onWrongSay?.[0] || "Let’s try again!");
        // keep mic visible so they can retry
      }
    };
  }

  async function listenAndCheckPhrase(target) {
    if (!target) return true;

    try {
      const blob = await recordOnce({ ms: 2600 });
      const transcript = await sttViaOpenAI(blob);

      console.log("STT transcript:", transcript);

      return kidForgivingMatch(transcript, target);
    } catch (e) {
      console.warn("STT mic flow failed:", e);
      return false;
    }
  }

  // Record once (MediaRecorder)
  async function recordOnce({ ms = 2600 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const rec = new MediaRecorder(stream);
    const chunks = [];

    return await new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = (e) => reject(e.error || e);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };

      rec.start();
      setTimeout(() => rec.stop(), ms);
    });
  }

  // Calls your existing /api/stt.js proxy (multipart forwarded as-is to OpenAI)
  async function sttViaOpenAI(blob) {
    const fd = new FormData();

    // IMPORTANT: must be "file" because OpenAI expects it and your proxy forwards raw multipart
    fd.append("file", blob, "speech.webm");
    fd.append("model", STT_MODEL);
    fd.append("language", STT_LANGUAGE);

    const res = await fetch("/api/stt", { method: "POST", body: fd });
    const data = await res.json();
    return (data?.text || "").trim();
  }

  // ===== Kid-forgiving matching =====
  function normalizeKo(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[\s\.\,\!\?\-_\(\)\[\]\{\}"'~]/g, "");
  }

  // Hangul syllable -> jamo decomposition
  function toJamo(str) {
    const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
    const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

    let out = "";
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code < 0xac00 || code > 0xd7a3) { out += ch; continue; }
      const sIndex = code - 0xac00;
      const cho = Math.floor(sIndex / (21 * 28));
      const jung = Math.floor((sIndex % (21 * 28)) / 28);
      const jong = sIndex % 28;
      out += CHO[cho] + JUNG[jung] + (JONG[jong] || "");
    }
    return out;
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
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

  function kidForgivingMatch(spoken, target) {
    const s0 = normalizeKo(spoken);
    const t0 = normalizeKo(target);
    if (!s0 || !t0) return false;
    if (s0 === t0) return true;

    // Allow common trailing “extra sounds”
    const s = s0.replace(/(요|이요|으)$/g, "");
    const t = t0.replace(/(요|이요|으)$/g, "");

    // Kids may say extra words (or STT may add extras)
    if (s.includes(t) || t.includes(s)) return true;

    const sj = toJamo(s);
    const tj = toJamo(t);

    const dist = levenshtein(sj, tj);
    const L = Math.max(sj.length, tj.length);

    // Forgiving threshold based on length
    const maxEdits = L <= 6 ? 1 : L <= 12 ? 2 : 3;

    return dist <= maxEdits;
  }

  // ===== Celebration + confetti =====
  async function celebrateCorrect(praiseLine) {
    const prevDr = charState.drColi;
    const prevBori = charState.bori;

    await setDrColi("wave").catch(() => {});
    await setBori("wave").catch(() => {});

    spawnFullScreenConfetti();
    await speakLine(praiseLine);

    await setDrColi(prevDr).catch(() => {});
    await setBori(prevBori).catch(() => {});
  }

  function spawnFullScreenConfetti() {
    const N = 60;
    const colors = ["#ff5a5f", "#ffd166", "#06d6a0", "#118ab2", "#9b5de5"];
    const w = fxLayerEl.clientWidth || window.innerWidth;
    const h = fxLayerEl.clientHeight || window.innerHeight;

    for (let i = 0; i < N; i++) {
      const piece = document.createElement("div");
      piece.style.position = "absolute";
      piece.style.left = Math.random() * w + "px";
      piece.style.top = "-20px";
      piece.style.width = "10px";
      piece.style.height = "14px";
      piece.style.background = colors[(Math.random() * colors.length) | 0];
      piece.style.opacity = "0.95";
      piece.style.borderRadius = "3px";
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.zIndex = "100";
      piece.style.pointerEvents = "none";

      const fall = 900 + Math.random() * 800;
      const drift = (Math.random() - 0.5) * 260;
      const dur = 900 + Math.random() * 700;

      piece.animate(
        [
          { transform: piece.style.transform, top: "-20px", left: piece.style.left, opacity: 1 },
          { transform: `rotate(${Math.random() * 720}deg)`, top: (h + fall) + "px", left: (parseFloat(piece.style.left) + drift) + "px", opacity: 0.85 }
        ],
        { duration: dur, easing: "cubic-bezier(.2,.6,.2,1)", fill: "forwards" }
      );

      fxLayerEl.appendChild(piece);
      setTimeout(() => piece.remove(), dur + 200);
    }
  }

  // ===== utils =====
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
})();
