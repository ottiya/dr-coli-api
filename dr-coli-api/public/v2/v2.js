/* public/v2/v2.js — Episode engine + ElevenLabs (Blob cached) */

let currentSceneIndex = 0;
let episodeData = null;

// DOM
const bgLayer = document.getElementById("bgLayer");
const dialogue = document.getElementById("dialogue");
const dialogueText = document.getElementById("dialogueText");

const emojiTray = document.getElementById("emojiTray");
const emojiSlots = Array.from(document.querySelectorAll(".emoji-slot"));

const micButton = document.getElementById("micButton");
const fxLayer = document.getElementById("fxLayer");
const viewport = document.getElementById("viewport");

// Confetti assets
const CONFETTI_ASSETS = [
  "/assets/ui/confetti-blue-ribbon.png",
  "/assets/ui/confetti-golden-ribbon.png",
  "/assets/ui/confetti-green-ribbon.png",
  "/assets/ui/confetti-pink-twirl.png",
  "/assets/ui/confetti-star.png",
];

// Audio
const voiceAudio = new Audio();
voiceAudio.preload = "auto";

// Autoplay unlock gate
let audioUnlocked = false;

function ensureAudioUnlocked() {
  if (audioUnlocked) return Promise.resolve(true);

  return new Promise((resolve) => {
    // Create a simple overlay button
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.zIndex = "9999";

    const btn = document.createElement("button");
    btn.textContent = "Tap to Start";
    btn.style.fontFamily = "Nunito, system-ui, sans-serif";
    btn.style.fontSize = "28px";
    btn.style.fontWeight = "900";
    btn.style.padding = "18px 28px";
    btn.style.borderRadius = "16px";
    btn.style.border = "none";
    btn.style.cursor = "pointer";

    overlay.appendChild(btn);
    viewport.appendChild(overlay);

    btn.onclick = async () => {
      // Try a silent play/pause to unlock
      try {
        voiceAudio.src = "";
        await voiceAudio.play().catch(() => {});
        voiceAudio.pause();
      } catch (e) {}

      audioUnlocked = true;
      overlay.remove();
      resolve(true);
    };
  });
}

// Load episode
fetch("/lessons/episode-01.json")
  .then((res) => {
    if (!res.ok) throw new Error(`Failed to load episode JSON: ${res.status}`);
    return res.json();
  })
  .then((data) => {
    episodeData = data;
    playScene(0);
  })
  .catch(console.error);

function playScene(index) {
  currentSceneIndex = index;
  if (!episodeData?.scenes?.[index]) return;

  const scene = episodeData.scenes[index];

  hideEmojiTray();
  hideMic();
  clearFX();
  stopVoice();

  setBackground(scene.background || episodeData.background || "bg-puppies.png");

  playDialogue(scene.drColi?.say || [], () => {
    enableInteraction(scene.interaction || { type: "none" });
  });
}

/* ===== Background ===== */
function setBackground(bgFile) {
  const path = bgFile.startsWith("/assets/")
    ? bgFile
    : `/assets/backgrounds/${bgFile}`;
  bgLayer.style.backgroundImage = `url("${path}")`;
}

/* ===== Voice ===== */
function stopVoice() {
  try {
    voiceAudio.pause();
    voiceAudio.currentTime = 0;
    voiceAudio.src = "";
  } catch (e) {}
}

async function getTtsUrl(text) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`TTS failed: ${res.status} ${msg}`);
  }

  const data = await res.json();
  return data.url;
}

function playAudioUrl(url) {
  return new Promise((resolve) => {
    stopVoice();
    voiceAudio.src = url;

    const cleanup = () => {
      voiceAudio.onended = null;
      voiceAudio.onerror = null;
      resolve();
    };

    voiceAudio.onended = cleanup;
    voiceAudio.onerror = cleanup;

    voiceAudio.play().catch(() => cleanup());
  });
}

/* ===== Dialogue (now with live TTS) ===== */
function normalizeLines(linesRaw) {
  if (!Array.isArray(linesRaw)) return [];
  return linesRaw
    .map((item) => (typeof item === "string" ? { text: item } : item))
    .filter((l) => l?.text && l.text.trim().length > 0)
    .map((l) => ({ text: l.text.trim() }));
}

async function playDialogue(linesRaw, done) {
  const lines = normalizeLines(linesRaw);

  if (!lines.length) {
    hideDialogue();
    done?.();
    return;
  }

  showDialogue();

  // Make sure audio can play on iOS/Chrome
  await ensureAudioUnlocked();

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    dialogueText.textContent = text;

    try {
      const url = await getTtsUrl(text);
      await playAudioUrl(url);
      await wait(120); // tiny natural pause
    } catch (e) {
      console.warn("TTS error, falling back to timer:", e);
      await wait(1400);
    }
  }

  await wait(200);
  done?.();
}

function showDialogue() {
  dialogue.classList.add("active");
}
function hideDialogue() {
  dialogue.classList.remove("active");
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ===== Interaction routing ===== */
function enableInteraction(interaction) {
  if (!interaction || interaction.type === "none") {
    setTimeout(() => playScene(currentSceneIndex + 1), 700);
    return;
  }
  if (interaction.type === "emoji") return showEmojiTray(interaction);
  if (interaction.type === "mic") return showMic(interaction);
  setTimeout(() => playScene(currentSceneIndex + 1), 700);
}

/* ===== Emoji ===== */
function showEmojiTray(interaction) {
  emojiTray.classList.add("active");

  const choices = interaction.choices || [];
  const correct = interaction.correctIndex ?? 0;

  emojiSlots.forEach((btn, i) => {
    btn.textContent = choices[i] || "";
    btn.disabled = false;
    btn.onclick = () => handleEmojiPick(i, correct, interaction);
  });
}

function hideEmojiTray() {
  emojiTray.classList.remove("active");
  emojiSlots.forEach((b) => {
    b.disabled = true;
    b.textContent = "";
    b.onclick = null;
  });
}

function handleEmojiPick(idx, correctIdx, interaction) {
  emojiSlots.forEach((b) => (b.disabled = true));

  if (idx === correctIdx) {
    playConfettiTopToBottom();
    dialogueText.textContent = interaction.praise || "Yes! Great job!";
    showDialogue();
    setTimeout(() => playScene(currentSceneIndex + 1), 2400);
  } else {
    dialogueText.textContent = interaction.retry || "Nice try! Let’s try again.";
    showDialogue();
    setTimeout(() => emojiSlots.forEach((b) => (b.disabled = false)), 700);
  }
}

/* ===== Mic ===== */
function showMic(interaction) {
  micButton.classList.remove("hidden");

  if (interaction?.prompt) {
    dialogueText.textContent = interaction.prompt;
    showDialogue();
  }

  micButton.onclick = () => {
    micButton.classList.add("hidden");
    micButton.onclick = null;
    playScene(currentSceneIndex + 1);
  };
}

function hideMic() {
  micButton.classList.add("hidden");
  micButton.onclick = null;
}

/* ===== Confetti (your beautiful version) ===== */
function playConfettiTopToBottom() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  const COUNT = 36;
  const MIN_DUR = 4200;
  const MAX_DUR = 6000;
  const SCALE = 0.35;

  for (let i = 0; i < COUNT; i++) {
    const img = document.createElement("img");
    img.className = "confetti-piece";
    img.src = CONFETTI_ASSETS[Math.floor(Math.random() * CONFETTI_ASSETS.length)];

    const baseSize = 60 + Math.random() * 40;
    const size = baseSize * SCALE;

    const startX = Math.random() * w;
    const startY = -size - Math.random() * 150;
    const endY = h + size + 120;
    const driftX = (Math.random() - 0.5) * 240;

    const rotStart = Math.random() * 360;
    const rotEnd = rotStart + (Math.random() - 0.5) * 1200;

    const duration = MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR);

    img.style.width = `${size}px`;
    img.style.left = `${startX}px`;
    img.style.top = `${startY}px`;

    fxLayer.appendChild(img);

    const anim = img.animate(
      [
        { transform: `translate(0, 0) rotate(${rotStart}deg)`, opacity: 1 },
        { transform: `translate(${driftX}px, ${endY}px) rotate(${rotEnd}deg)`, opacity: 1 },
      ],
      { duration, easing: "linear", fill: "forwards" }
    );

    anim.onfinish = () => img.remove();
  }
}

function clearFX() {
  fxLayer.innerHTML = "";
}
