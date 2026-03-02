/* public/v2/v2.js — Episode engine + ElevenLabs TTS + STT mic checking */

let currentSceneIndex = 0;
let episodeData = null;

// DOM
const bgLayer = document.getElementById("bgLayer");
const dialogueEl = document.getElementById("dialogue");
const dialogueTextEl = document.getElementById("dialogueText");

const emojiTrayEl = document.getElementById("emojiTray");
const emojiButtons = Array.from(document.querySelectorAll(".emoji-slot"));

const micButtonEl = document.getElementById("micButton");
const fxLayer = document.getElementById("fxLayer");

const audioGateEl = document.getElementById("audioGate");

// shared audio for TTS
const ttsAudio = new Audio();
ttsAudio.preload = "auto";

boot().catch((e) => console.error("BOOT ERROR:", e));

async function boot() {
  setBackground("/assets/backgrounds/bg-puppies.png");
  episodeData = await fetchJson("/lessons/episode-01.json");
  await waitForAudioUnlock();

  // Generate Scene 0 first so we start strong
  await preGenerateSceneAudio(episodeData, 0);
  preGenerateRemainingScenes(episodeData).catch(console.warn);

  playScene(0);
}

/* ===== Audio unlock (tap anywhere) ===== */
function waitForAudioUnlock() {
  return new Promise((resolve) => {
    audioGateEl.classList.remove("hidden");

    const unlock = async () => {
      try {
        ttsAudio.src = "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA";
        await ttsAudio.play().catch(() => {});
        ttsAudio.pause();
        ttsAudio.currentTime = 0;
        ttsAudio.src = "";
      } catch {}

      audioGateEl.classList.add("hidden");
      audioGateEl.removeEventListener("pointerdown", unlock);
      resolve();
    };

    audioGateEl.addEventListener("pointerdown", unlock, { once: true });
  });
}

/* ===== Fetch helpers ===== */
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setBackground(path) {
  bgLayer.style.backgroundImage = `url("${path}")`;
}

/* ===== TTS (ElevenLabs cached) ===== */
async function getElevenLabsTtsUrl(text) {
  const res = await fetch("/api/tts-elevenlabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("TTS FAILED:", res.status, detail, "TEXT:", text);
    return null;
  }

  const data = await res.json().catch(() => null);
  return data?.url || null;
}

async function preGenerateSceneAudio(ep, sceneIndex) {
  const scene = ep?.scenes?.[sceneIndex];
  if (!scene) return;

  const lines = scene?.drColi?.say || [];
  scene._audioUrls = scene._audioUrls || [];

  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || "").trim();
    if (!text) {
      scene._audioUrls[i] = null;
      continue;
    }
    if (scene._audioUrls[i]) continue;

    const url = await getElevenLabsTtsUrl(text);
    scene._audioUrls[i] = url;
  }
}

async function preGenerateRemainingScenes(ep) {
  if (!ep?.scenes?.length) return;
  for (let s = 1; s < ep.scenes.length; s++) {
    await preGenerateSceneAudio(ep, s);
    await sleep(120);
  }
}

/* ===== Scene engine ===== */
function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData?.scenes?.[index]) {
    endEpisode();
    return;
  }

  const scene = episodeData.scenes[index];

  hideEmojiTray();
  hideMic();
  clearFx();

  setBackground(scene.background || "/assets/backgrounds/bg-puppies.png");

  const lines = scene?.drColi?.say || [];
  const urls = scene?._audioUrls || [];

  playDialogueWithAudio(lines, urls, () => {
    enableInteraction(scene.interaction || { type: "none" });
  });
}

/* ===== Dialogue + audio ===== */
function showDialogue(text) {
  dialogueEl.classList.add("active");
  dialogueTextEl.textContent = text;
}
function hideDialogue() {
  dialogueEl.classList.remove("active");
  dialogueTextEl.textContent = "";
}

function stopTts() {
  try {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
  } catch {}
}

function playTtsUrl(url) {
  return new Promise((resolve) => {
    stopTts();
    ttsAudio.src = url;

    const cleanup = () => {
      ttsAudio.onended = null;
      ttsAudio.onerror = null;
      resolve();
    };

    ttsAudio.onended = cleanup;
    ttsAudio.onerror = cleanup;

    ttsAudio.play().catch(cleanup);
  });
}

async function playDialogueWithAudio(lines, urls, done) {
  if (!lines || lines.length === 0) {
    hideDialogue();
    done?.();
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || "").trim();
    if (!text) continue;

    showDialogue(text);

    let url = urls?.[i] || null;
    if (!url) {
      url = await getElevenLabsTtsUrl(text);
      episodeData.scenes[currentSceneIndex]._audioUrls[i] = url;
    }

    if (url) {
      await playTtsUrl(url);
      await sleep(160);
    } else {
      await sleep(Math.max(850, Math.min(2000, text.length * 30)));
    }
  }

  await sleep(150);
  hideDialogue();
  done?.();
}

/* ===== Interaction ===== */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === "none") {
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }

  if (interaction.type === "emoji") {
    showEmojiTray(
      interaction.choices || ["🙇‍♀️", "👋", "🏃‍♀️"],
      interaction.correctIndex ?? 0
    );
    return;
  }

  if (interaction.type === "mic") {
    showMic(interaction.target || "");
    return;
  }

  setTimeout(() => playScene(currentSceneIndex + 1), 700);
}

/* ===== Emoji tray ===== */
function showEmojiTray(choices, correctIndex) {
  emojiTrayEl.classList.add("active");

  emojiButtons.forEach((btn, idx) => {
    btn.textContent = choices?.[idx] || "";
    btn.onclick = () => {
      if (idx === correctIndex) {
        confettiFullScreen();
        showDialogue("Yes! Great job!");
        setTimeout(() => {
          hideEmojiTray();
          playScene(currentSceneIndex + 1);
        }, 900);
      } else {
        showDialogue("Nice try! Try again!");
      }
    };
  });
}

function hideEmojiTray() {
  emojiTrayEl.classList.remove("active");
  emojiButtons.forEach((btn) => (btn.onclick = null));
}

/* ===== Mic + STT ===== */
function showMic(targetKorean) {
  micButtonEl.classList.remove("hidden");
  micButtonEl.onclick = async () => {
    micButtonEl.onclick = null;

    showDialogue("I’m listening… 🎤");
micButtonEl.classList.add("listening");
    const transcript = await recordAndTranscribeOnce();
    micButtonEl.classList.remove("listening");

    if (!transcript) {
      showDialogue("I couldn’t hear that—try again! 🎤");
      micButtonEl.onclick = () => showMic(targetKorean);
      micButtonEl.classList.remove("hidden");
      return;
    }

    const heard = transcript.trim();
    const ok = isForgivingMatch(heard, targetKorean);

    // show what we heard (helps debugging + kids love it)
    showDialogue(`I heard: “${heard}”`);

    if (ok) {
      confettiFullScreen();
      setTimeout(() => {
        showDialogue("Yes!! Amazing job! ⭐");
      }, 350);

      setTimeout(() => {
        hideMic();
        playScene(currentSceneIndex + 1);
      }, 1200);
    } else {
      setTimeout(() => {
        showDialogue("So close! Let’s try together one more time.");
        micButtonEl.classList.remove("hidden");
        micButtonEl.onclick = () => showMic(targetKorean);
      }, 900);
    }
  };
}

function hideMic() {
  micButtonEl.classList.add("hidden");
  micButtonEl.onclick = null;
}

// Records ~2.2 seconds and transcribes via /api/stt
async function recordAndTranscribeOnce() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickRecorderMimeType();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise((resolve) => (recorder.onstop = resolve));

    recorder.start();

    // record a short burst (kid phrase)
    await sleep(2200);
    recorder.stop();

    await stopped;

    // stop mic
    stream.getTracks().forEach((t) => t.stop());

    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    if (blob.size < 5000) return null;

    const file = new File([blob], "speech.webm", { type: blob.type });

    const form = new FormData();
    form.append("file", file);                 // OpenAI expects "file" in multipart
    form.append("model", "gpt-4o-mini-transcribe"); // fast+good :contentReference[oaicite:3]{index=3}
    form.append("language", "ko");

    const res = await fetch("/api/stt", { method: "POST", body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("STT failed:", res.status, detail);
      return null;
    }

    const data = await res.json().catch(() => null);
    return data?.text || null;
  } catch (e) {
    console.error("recordAndTranscribeOnce error:", e);
    return null;
  }
}

function pickRecorderMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/* ===== Forgiving matching ===== */

// normalize Korean text for comparison
function normalizeKo(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?~'"“”‘’]/g, "")
    .replace(/-/g, "")
    // common ASR-ish variants that show up with kids
    .replace(/세이요/g, "세요")
    .replace(/하세용/g, "하세요")
    .replace(/하세여/g, "하세요");
}

// collapse repeats like "안녕하세요안녕하세요" -> "안녕하세요"
function collapseRepeats(norm, targetNorm) {
  if (!targetNorm) return norm;
  while (norm.includes(targetNorm + targetNorm)) {
    norm = norm.replace(targetNorm + targetNorm, targetNorm);
  }
  return norm;
}

// Levenshtein distance (small + fast)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

// forgiving match for Korean target phrases
function isForgivingMatch(heardRaw, targetRaw) {
  const target = normalizeKo(targetRaw);
  if (!target) return true;

  let heard = normalizeKo(heardRaw);
  heard = collapseRepeats(heard, target);

  // 1) perfect or contains (handles extra words)
  if (heard === target) return true;
  if (heard.includes(target)) return true;

  // 2) allow a small edit distance (kids speech / ASR quirks)
  const d = levenshtein(heard, target);

  // very short targets need stricter matching
  if (target.length <= 2) return d <= 0; // e.g., "안녕" shouldn’t accept too much
  if (target.length <= 4) return d <= 1;
  return d <= 2; // "안녕하세요" forgiving
}

/* ===== Confetti ===== */
function confettiFullScreen() {
  clearFx();

  const PIECES = 28;
  const DURATION_MIN = 1200;
  const DURATION_MAX = 2200;

  for (let i = 0; i < PIECES; i++) {
    const el = document.createElement("img");
    el.src = "/assets/ui/confetti-star.png";
    el.alt = "";
    el.style.position = "absolute";
    el.style.top = "-10%";
    el.style.left = `${Math.random() * 100}%`;
    el.style.pointerEvents = "none";
    el.style.opacity = "0.95";

    const scale = 0.35 + Math.random() * 0.15;
    el.style.transform = `translate(-50%, 0) scale(${scale})`;

    fxLayer.appendChild(el);

    const drift = Math.random() * 120 - 60;
    const rotate = Math.random() * 720 - 360;
    const duration = DURATION_MIN + Math.random() * (DURATION_MAX - DURATION_MIN);

    el.animate(
      [
        { transform: `translate(-50%, 0) scale(${scale}) rotate(0deg)`, opacity: 0.95 },
        { transform: `translate(calc(-50% + ${drift}px), 120vh) scale(${scale}) rotate(${rotate}deg)`, opacity: 0.95 },
        { transform: `translate(calc(-50% + ${drift}px), 140vh) scale(${scale}) rotate(${rotate}deg)`, opacity: 0 },
      ],
      { duration, easing: "ease-in", fill: "forwards" }
    );

    setTimeout(() => el.remove(), duration + 50);
  }

  setTimeout(clearFx, DURATION_MAX + 400);
}

function clearFx() {
  fxLayer.innerHTML = "";
}

/* ===== End ===== */
function endEpisode() {
  hideEmojiTray();
  hideMic();
  hideDialogue();
  clearFx();
  console.log("Episode finished!");
}
