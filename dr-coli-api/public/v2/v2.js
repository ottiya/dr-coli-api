/* public/v2/v2.js — Episode engine + ElevenLabs pregen (Blob cached) + reliable audio unlock */

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
const startAudioBtn = document.getElementById("startAudioBtn");

// single shared audio element (better for autoplay reliability)
const audio = new Audio();
audio.preload = "auto";

boot().catch((e) => console.error("BOOT ERROR:", e));

async function boot() {
  setBackground("/assets/backgrounds/bg-puppies.png");

  episodeData = await fetchJson("/lessons/episode-01.json");

  // Must tap once to unlock audio
  await waitForAudioUnlock();

  // IMPORTANT: generate Scene 0 first + preload its first clip
  await preGenerateSceneAudio(episodeData, 0);
  await preloadFirstClipIfExists(episodeData, 0);

  // Then pre-generate rest in background (don’t block demo)
  preGenerateRemainingScenes(episodeData).catch((e) =>
    console.warn("Background pregen error:", e)
  );

  playScene(0);
}

/* ===== Audio unlock ===== */
function waitForAudioUnlock() {
  return new Promise((resolve) => {
    audioGateEl.classList.remove("hidden");

    startAudioBtn.onclick = async () => {
      try {
        // Attempt a play/pause on the real shared audio element
        audio.src = "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA";
        await audio.play().catch(() => {});
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
      } catch {}

      audioGateEl.classList.add("hidden");
      startAudioBtn.onclick = null;
      resolve();
    };
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

/* ===== Background ===== */
function setBackground(path) {
  bgLayer.style.backgroundImage = `url("${path}")`;
}

/* ===== TTS helpers ===== */
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
  if (!data?.url) {
    console.error("TTS RESPONSE MISSING url:", data, "TEXT:", text);
    return null;
  }
  return data.url;
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

async function preloadFirstClipIfExists(ep, sceneIndex) {
  const scene = ep?.scenes?.[sceneIndex];
  const firstUrl = scene?._audioUrls?.[0];
  if (!firstUrl) return;

  try {
    // preload by fetching; browser caches it
    await fetch(firstUrl, { mode: "cors" }).catch(() => {});
  } catch {}
}

async function preGenerateRemainingScenes(ep) {
  if (!ep?.scenes?.length) return;
  for (let s = 1; s < ep.scenes.length; s++) {
    await preGenerateSceneAudio(ep, s);
    // tiny pause so we don’t hammer
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

function stopAudio() {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {}
}

function playAudioUrl(url) {
  return new Promise((resolve) => {
    stopAudio();
    audio.src = url;

    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      resolve();
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;

    audio.play().catch(() => {
      // If anything blocks, resolve so lesson continues
      cleanup();
    });
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

    // If url missing (not generated yet), try generating on demand
    let url = urls?.[i] || null;
    if (!url) {
      url = await getElevenLabsTtsUrl(text);
      if (episodeData?.scenes?.[currentSceneIndex]) {
        episodeData.scenes[currentSceneIndex]._audioUrls[i] = url;
      }
    }

    if (url) {
      await playAudioUrl(url);
      await sleep(180);
    } else {
      // fallback timer if TTS fails
      await sleep(Math.max(900, Math.min(2200, text.length * 35)));
    }
  }

  await sleep(200);
  hideDialogue();
  done?.();
}

/* ===== Interaction ===== */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === "none") {
    setTimeout(() => playScene(currentSceneIndex + 1), 800);
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
    showMic();
    return;
  }

  setTimeout(() => playScene(currentSceneIndex + 1), 800);
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

/* ===== Mic ===== */
function showMic() {
  micButtonEl.classList.remove("hidden");
  micButtonEl.onclick = () => {
    hideMic();
    playScene(currentSceneIndex + 1);
  };
}

function hideMic() {
  micButtonEl.classList.add("hidden");
  micButtonEl.onclick = null;
}

/* ===== Confetti ===== */
function confettiFullScreen() {
  clearFx();
  const img = document.createElement("img");
  img.src = "/assets/ui/confetti-star.png";
  img.alt = "";
  img.style.position = "absolute";
  img.style.left = "0";
  img.style.top = "-20%";
  img.style.width = "100%";
  img.style.opacity = "0.95";
  img.style.pointerEvents = "none";

  img.animate(
    [
      { transform: "translateY(0)", opacity: 0.95 },
      { transform: "translateY(140%)", opacity: 0.95 },
      { transform: "translateY(160%)", opacity: 0 },
    ],
    { duration: 1800, easing: "ease-in", fill: "forwards" }
  );

  fxLayer.appendChild(img);
  setTimeout(clearFx, 1900);
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
