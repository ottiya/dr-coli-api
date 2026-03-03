/* public/v2/v2.js
   Pixi v7 + lazy-load sheets + ElevenLabs TTS + OpenAI STT mic check (kid-forgiving)
   Feel polish:
   - Bori mostly idle (look 20% during speech, 10% during downtime)
   - When waiting for interaction: both idle
   - Grounding: align feet + move closer to bottom
   - Mic glow after prompt (adds .attention class)
   - Confetti uses /assets/ui PNGs
   - Smoother ping-pong + natural frame sort to reduce jerk
*/

(() => {
  if (window.__DRCOLI_V2_BOOTED__) return;
  window.__DRCOLI_V2_BOOTED__ = true;

  // ===== Constants =====
  const DEFAULT_BG = "/assets/backgrounds/bg-puppies.png";
  const EPISODE_URL = "/lessons/episode-01.json";
  const CHARACTER_MANIFEST_URL = "/assets/characters.manifest.json";

  // TTS tuning
  const TTS_RATE = 1.25;
  const BETWEEN_LINES_MS = 80;

  // STT tuning
  const STT_MODEL = "gpt-4o-mini-transcribe"; // or "gpt-4o-transcribe"
  const STT_LANGUAGE = "ko";

  // Animation tuning
  const DEFAULT_ANIM_SPEED = 0.22; // slightly faster overall

  // Bori behavior
  const BORIS_LOOK_DURING_SPEECH = 0.20;   // 20%
  const BORIS_LOOK_DURING_DOWNTIME = 0.10; // 10% (50% less than speech)
  const BORIS_DOWNTIME_REROLL_MS_MIN = 1600;
  const BORIS_DOWNTIME_REROLL_MS_MAX = 3200;

  // Position tuning
  const GROUND_MARGIN_RATIO = 0.028; // smaller = closer to bottom
  const GROUND_MARGIN_MIN = 14;
  const GROUND_MARGIN_MAX = 34;

  const CHAR_SCALE_MIN = 0.33;
  const CHAR_SCALE_MAX = 0.62;

  const GAP_MIN = 140;
  const GAP_MAX = 360;

  // Per-character baseline offsets (to align "feet" if spritesheets differ)
  const DRCOLI_Y_OFFSET = 0;
  const BORI_Y_OFFSET = 10; // adjust +/- if needed after you see it

  // Confetti assets (120x120 -> we render around ~24px)
  const CONFETTI_IMAGES = [
    "/assets/ui/confetti-blue-ribbon.png",
    "/assets/ui/confetti-golden-ribbon.png",
    "/assets/ui/confetti-green-ribbon.png",
    "/assets/ui/confetti-pink-twirl.png",
    "/assets/ui/confetti-star.png",
  ];

  // ===== State =====
  let currentSceneIndex = 0;
  let episodeData = null;
  let characterManifest = null;

  let pixiApp = null;
  let drColiSprite = null;
  let boriSprite = null;

  // cache: characterKey -> stateName -> textures[]
  const textureCache = { drColi: {}, bori: {} };

  // Current requested states (what we *want* them to be)
  const charState = { drColi: "idle", bori: "idle" };

  // UI + DOM
  let bgLayer, dialogueEl, dialogueTextEl, emojiTrayEl, micButtonEl, fxLayerEl, stageLayerEl;

  // Interaction gates
  let userInteracted = false;
  let unlockPromise = null;
  let micPrewarmed = false;

  // Whether we're currently in an interaction waiting state
  let interactionActive = false;

  // Bori downtime timer
  let boriDowntimeTimer = null;

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

    if (PIXI.Assets?.init) {
      await PIXI.Assets.init({ manifest: null }).catch(() => {});
    }

    const [ep, man] = await Promise.all([
      fetchJSON(EPISODE_URL),
      fetchJSON(CHARACTER_MANIFEST_URL),
    ]);

    episodeData = ep;
    characterManifest = normalizeManifest(man);

    // Fast boot
    await Promise.all([
      ensureStateLoaded("drColi", "idle"),
      ensureStateLoaded("bori", "idle"),
      ensureStateLoaded("drColi", "talk").catch(() => {}),
      ensureStateLoaded("bori", "look").catch(() => {}),
    ]);

    createCharacters();
    playScene(0);
  }

  function normalizeManifest(man) {
    if (!man || typeof man !== "object") return man;
    if (man.drColi && man.bori) return man;

    const out = {};
    out.drColi = man.drColi || man.DrColi || man.drcoli || man["dr-coli"] || man["dr_coli"] || null;
    out.bori = man.bori || man.Bori || null;

    if (out.drColi || out.bori) return out;
    return man;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return await res.json();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ===== UI layout fixes =====
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
    playCharacterState(drColiSprite, drIdle, { speed: DEFAULT_ANIM_SPEED, pingpong: true });
    playCharacterState(boriSprite, boriIdle, { speed: DEFAULT_ANIM_SPEED, pingpong: true });
  }

  function positionCharacters() {
    if (!pixiApp || !drColiSprite || !boriSprite) return;

    const w = pixiApp.renderer.width;
    const h = pixiApp.renderer.height;

    const scale = clamp(w / 1200, CHAR_SCALE_MIN, CHAR_SCALE_MAX);
    drColiSprite.scale.set(scale);
    boriSprite.scale.set(scale);

    // Closer to bottom
    const margin = clamp(h * GROUND_MARGIN_RATIO, GROUND_MARGIN_MIN, GROUND_MARGIN_MAX);
    const groundY = h - margin;

    const gap = clamp(w * 0.18, GAP_MIN, GAP_MAX);
    const cx = w * 0.5;

    drColiSprite.x = cx - gap / 2;
    boriSprite.x = cx + gap / 2;

    // Align “feet” on same ground line (with small offsets if needed)
    drColiSprite.y = groundY + DRCOLI_Y_OFFSET;
    boriSprite.y = groundY + BORI_Y_OFFSET;
  }

  // ===== State setters =====
  async function setDrColi(state, opts = {}) {
    charState.drColi = state;
    await ensureStateLoaded("drColi", state);
    playCharacterState(drColiSprite, textureCache.drColi[state], { speed: DEFAULT_ANIM_SPEED, pingpong: true, ...opts });
  }

  async function setBori(state, opts = {}) {
    charState.bori = state;
    await ensureStateLoaded("bori", state);
    playCharacterState(boriSprite, textureCache.bori[state], { speed: DEFAULT_ANIM_SPEED, pingpong: true, ...opts });
  }

  // ===== Smooth ping-pong =====
  function playCharacterState(sprite, textures, { speed = DEFAULT_ANIM_SPEED, pingpong = true } = {}) {
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

    // Smooth pingpong using onFrameChange reversal (no stop/restart)
    const abs = Math.abs(speed || DEFAULT_ANIM_SPEED);

    sprite.loop = true;
    sprite.animationSpeed = abs;
    sprite._pingpong = !!pingpong;

    sprite.onFrameChange = (frame) => {
      if (!sprite._pingpong) return;
      if (frame === textures.length - 1) sprite.animationSpeed = -abs;
      else if (frame === 0) sprite.animationSpeed = abs;
    };

    sprite.play();
  }

  // ===== Manifest-driven lazy loading =====
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
      const sheetTextures = await loadSpritesheetTexturesSafe(jsonUrl, `${characterKey}.${stateName}`);
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
      const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
      if (nn) return nn;
    }
    return ax.length - bx.length;
  }

  async function loadSpritesheetTexturesSafe(jsonUrl, label) {
    try {
      const loaded = await PIXI.Assets.load(jsonUrl);

      const sheet =
        loaded?.textures ? loaded :
        loaded?.spritesheet?.textures ? loaded.spritesheet :
        null;

      if (!sheet || !sheet.textures) {
        console.warn(`[sheet] No textures found for ${label}: ${jsonUrl}`);
        return [];
      }

      // Natural numeric sort to reduce jerkiness (e.g. 1,2,3...10 not 1,10,2)
      const keys = Object.keys(sheet.textures).sort(naturalCompare);
      return keys.map(k => sheet.textures[k]);
    } catch (err) {
      console.error(`[sheet] Failed to load ${label}: ${jsonUrl}`, err);
      return [];
    }
  }

  // ===== Scene engine =====
  function playScene(index) {
    stopBoriDowntime();
    interactionActive = false;

    currentSceneIndex = index;
    const scene = episodeData?.scenes?.[index];
    if (!scene) return;

    setBackground(scene.background || episodeData.background || DEFAULT_BG);

    // Use scene-provided animations for first pose, but Bori policy may override during speech.
    const drAnim = scene.drColi?.animation || "idle";
    const boriAnim = scene.bori?.animation || "idle";

    setDrColi(drAnim).catch(() => {});
    setBori(boriAnim).catch(() => {});

    const lines = scene.drColi?.say || [];
    playDialogue(lines, () => {
      enableInteraction(scene.interaction || { type: "none" });
    });
  }

  async function playDialogue(lines, done) {
    if (!lines || lines.length === 0) {
      hideDialogue();
      done?.();
      return;
    }

    showDialogue();
    await drColiSay(lines);
    done?.();
  }

  function showDialogue() {
    dialogueEl.style.display = "block";
  }

  function hideDialogue() {
    dialogueEl.style.display = "none";
    dialogueTextEl.textContent = "";
  }

  // ===== Bori “listening” policy =====
  async function setBoriDuringSpeech() {
    // Only do this if we are not in interaction waiting mode
    if (interactionActive) {
      await setBori("idle").catch(() => {});
      return;
    }
    const r = Math.random();
    if (r < BORIS_LOOK_DURING_SPEECH) await setBori("look").catch(() => {});
    else await setBori("idle").catch(() => {});
  }

  function startBoriDowntime() {
    stopBoriDowntime();
    if (interactionActive) return;

    const reroll = async () => {
      if (interactionActive) return;
      // 10% look during downtime, otherwise idle
      if (Math.random() < BORIS_LOOK_DURING_DOWNTIME) {
        await setBori("look").catch(() => {});
      } else {
        await setBori("idle").catch(() => {});
      }
      const next = BORIS_DOWNTIME_REROLL_MS_MIN + Math.random() * (BORIS_DOWNTIME_REROLL_MS_MAX - BORIS_DOWNTIME_REROLL_MS_MIN);
      boriDowntimeTimer = setTimeout(reroll, next);
    };

    const first = 600 + Math.random() * 800;
    boriDowntimeTimer = setTimeout(reroll, first);
  }

  function stopBoriDowntime() {
    if (boriDowntimeTimer) clearTimeout(boriDowntimeTimer);
    boriDowntimeTimer = null;
  }

  // ===== Dr. Coli bubble + voice helper =====
  async function drColiSay(lines) {
    stopBoriDowntime();
    const arr = Array.isArray(lines) ? lines : [lines];
    showDialogue();

    for (const line of arr) {
      const msg = String(line ?? "").trim();
      if (!msg) continue;

      dialogueTextEl.textContent = msg;

      await setDrColi("talk").catch(() => {});
      await setBoriDuringSpeech(); // <-- main “Bori mostly idle while speech” behavior

      await speakLine(msg);
      await sleep(BETWEEN_LINES_MS);
    }

    // After speech ends: return to idle + start downtime behavior (if not interacting)
    await setDrColi("idle").catch(() => {});
    if (!interactionActive) {
      await setBori("idle").catch(() => {});
      startBoriDowntime();
    }
  }

  // ===== Start overlay (unlocks audio + asks mic permission early) =====
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
      await prewarmMicPermission();
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
    } catch {}
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

  async function prewarmMicPermission() {
    if (micPrewarmed) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      micPrewarmed = true;
      return true;
    } catch (e) {
      console.warn("Mic permission denied/unavailable:", e);
      return false;
    }
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
        const detail = await res.text().catch(() => "");
        console.warn("ElevenLabs TTS error:", res.status, detail.slice(0, 200));
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

    // Reset UI
    emojiTrayEl.classList.add("hidden");
    emojiTrayEl.classList.remove("active");
    micButtonEl.classList.add("hidden");
    micButtonEl.classList.remove("listening");
    micButtonEl.classList.remove("attention");
    micButtonEl.onclick = null;

    interactionActive = (type === "mic" || type === "emoji");
    stopBoriDowntime();

    // While waiting for interaction: both idle
    if (interactionActive) {
      setDrColi("idle").catch(() => {});
      setBori("idle").catch(() => {});
    }

    if (type === "none") return autoAdvance();
    if (type === "emoji") return showEmojiInteraction(interaction);
    if (type === "mic") return showMicInteraction(interaction);

    autoAdvance();
  }

  function autoAdvance() {
    interactionActive = false;
    startBoriDowntime();
    setTimeout(() => playScene(currentSceneIndex + 1), 350);
  }

  // ===== Emoji =====
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
          await drColiSay(interaction.onWrongSay?.[0] || "Nice try! Let’s try again.");
        }
      };
    });
  }

  // ===== Mic (OpenAI STT + forgiving match) =====
  function showMicInteraction(interaction) {
    const targets = Array.isArray(interaction.targets)
      ? interaction.targets.map(t => String(t).trim()).filter(Boolean)
      : [(interaction.target || "")].map(t => String(t).trim()).filter(Boolean);

    const prompt =
      interaction.prompt ||
      (targets[0] ? `Tap the mic, then say ${targets[0]}!` : "Tap the mic, then speak!");

    micButtonEl.classList.remove("hidden");
    micButtonEl.classList.remove("listening");
    micButtonEl.classList.remove("attention");

    // Speak prompt, then glow mic
    micButtonEl.disabled = true;
    drColiSay(prompt).finally(() => {
      // after prompt ends: both idle (waiting)
      setDrColi("idle").catch(() => {});
      setBori("idle").catch(() => {});

      micButtonEl.disabled = false;
      micButtonEl.classList.add("attention"); // <-- glow hook (CSS later)
    });

    micButtonEl.onclick = async () => {
      await waitForUserInteraction();
      await prewarmMicPermission();

      micButtonEl.classList.remove("attention");
      micButtonEl.classList.add("listening");
      micButtonEl.disabled = true;

      const { ok } = await listenAndCheckPhrase(targets, interaction.strictness);

      micButtonEl.classList.remove("listening");
      micButtonEl.disabled = false;

      if (ok) {
        await celebrateCorrect(interaction.onSuccessSay?.[0] || "Yes!! Amazing job!");
        micButtonEl.classList.add("hidden");
        playScene(currentSceneIndex + 1);
      } else {
        await drColiSay(interaction.onFailSay?.[0] || "So close! Let’s try together one more time.");
        // stay waiting; glow again
        micButtonEl.classList.add("attention");
        setDrColi("idle").catch(() => {});
        setBori("idle").catch(() => {});
      }
    };
  }

  async function listenAndCheckPhrase(targets, strictness) {
    const hasTargets = Array.isArray(targets) && targets.length > 0;

    try {
      const blob = await recordOnce({ ms: 2600 });
      const transcript = await sttViaOpenAI(blob);

      const cleaned = normalizeKo(transcript);
      if (!cleaned) return { ok: false, transcript: transcript || "" };

      if (!hasTargets) return { ok: true, transcript };

      for (const t of targets) {
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

  async function sttViaOpenAI(blob) {
    const fd = new FormData();
    fd.append("file", blob, "speech.webm");
    fd.append("model", STT_MODEL);
    fd.append("language", STT_LANGUAGE);

    const res = await fetch("/api/stt", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    return (data?.text || "").trim();
  }

  // ===== Kid-forgiving matching =====
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

  function kidForgivingMatchAdvanced(spoken, target, strictness) {
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
    if (strictness === "strict") maxEdits = 1;
    else if (strictness === "easy") maxEdits = L <= 6 ? 2 : L <= 12 ? 3 : 4;
    else maxEdits = L <= 6 ? 1 : L <= 12 ? 2 : 3;

    return dist <= maxEdits;
  }

  // ===== Celebration =====
  async function celebrateCorrect(praiseLine) {
    const prevDr = charState.drColi;
    const prevBori = charState.bori;

    setDrColi("wave", { speed: 0.25 }).catch(() => {});
    setBori("wave", { speed: 0.25 }).catch(() => {});

    spawnImageConfetti();
    await drColiSay(praiseLine);

    setDrColi(prevDr || "idle").catch(() => {});
    setBori(prevBori || "idle").catch(() => {});
  }

  function spawnImageConfetti() {
    const N = 45;
    const w = fxLayerEl.clientWidth || window.innerWidth;
    const h = fxLayerEl.clientHeight || window.innerHeight;

    for (let i = 0; i < N; i++) {
      const img = document.createElement("img");
      img.src = CONFETTI_IMAGES[(Math.random() * CONFETTI_IMAGES.length) | 0];
      img.alt = "";
      img.style.position = "absolute";
      img.style.left = Math.random() * w + "px";
      img.style.top = (-40 - Math.random() * 60) + "px";
      img.style.width = (18 + Math.random() * 12) + "px"; // ~20% of 120px
      img.style.height = "auto";
      img.style.opacity = "0.95";
      img.style.zIndex = "100";
      img.style.pointerEvents = "none";
      fxLayerEl.appendChild(img);

      const drift = (Math.random() - 0.5) * 280;
      const dur = 1200 + Math.random() * 900;
      const rot0 = Math.random() * 360;
      const rot1 = rot0 + (Math.random() * 720 + 360);

      img.animate(
        [
          { transform: `translate(0px, 0px) rotate(${rot0}deg)`, opacity: 1 },
          { transform: `translate(${drift}px, ${h + 80}px) rotate(${rot1}deg)`, opacity: 0.98 }
        ],
        { duration: dur, easing: "cubic-bezier(.2,.6,.2,1)", fill: "forwards" }
      );

      setTimeout(() => img.remove(), dur + 200);
    }
  }
})();
