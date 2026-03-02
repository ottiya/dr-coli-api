/* public/v2/v2.js
   Episode engine + pre-generate ElevenLabs TTS on load (Blob cached).
*/

let currentSceneIndex = 0;
let episodeData = null;

// ====== DOM ======
const bgLayer = document.getElementById("bgLayer");
const dialogueEl = document.getElementById("dialogue");
const dialogueTextEl = document.getElementById("dialogueText");

const emojiTrayEl = document.getElementById("emojiTray");
const emojiButtons = Array.from(document.querySelectorAll(".emoji-slot"));

const micButtonEl = document.getElementById("micButton");
const fxLayer = document.getElementById("fxLayer");

// ====== Audio ======
let audio = null;

// ====== Boot ======
boot().catch((e) => console.error("BOOT ERROR:", e));

async function boot() {
  // Default background so it’s not black while loading
  setBackground("/assets/backgrounds/bg-puppies.png");

  // Load episode JSON
  episodeData = await fetchJson("/lessons/episode-01.json");

  // Pre-generate / fetch cached audio for all Dr. Coli lines
  await preGenerateEpisodeAudio(episodeData);

  // Start
  playScene(0);
}

// ====== Helpers ======
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

function setBackground(path) {
  bgLayer.style.backgroundImage = `url("${path}")`;
}

function setDrColi(animationName) {
  // placeholder - wire your sprite engine later
  // console.log("DrColi animation:", animationName);
}

function setBori(animationName) {
  // placeholder - wire your sprite engine later
  // console.log("Bori animation:", animationName);
}

// ====== Episode audio pre-gen ======
async function preGenerateEpisodeAudio(ep) {
  if (!ep?.scenes?.length) return;

  // Collect all lines in order and store back into scene._audioUrls
  const tasks = [];

  for (let s = 0; s < ep.scenes.length; s++) {
    const scene = ep.scenes[s];
    const lines = scene?.drColi?.say || [];
    scene._audioUrls = [];

    for (let i = 0; i < lines.length; i++) {
      const text = String(lines[i] || "").trim();
      if (!text) {
        scene._audioUrls.push(null);
        continue;
      }

      // Create a task that fetches URL and stores it in the right index
      const task = (async () => {
        const url = await getElevenLabsTtsUrl(text);
        scene._audioUrls[i] = url;
      })();

      tasks.push(task);
    }
  }

  // Run in batches to avoid hammering the API
  const BATCH_SIZE = 4;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const chunk = tasks.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk);
  }
}

async function getElevenLabsTtsUrl(text) {
  const res = await fetch("/api/tts-elevenlabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("TTS endpoint failed:", res.status, detail);
    return null; // fallback: no audio
  }

  const data = await res.json();
  return data?.url || null;
}

// ====== Scene player ======
function playScene(index) {
  currentSceneIndex = index;

  if (!episodeData?.scenes?.[index]) {
    console.warn("Scene not found:", index);
    endEpisode();
    return;
  }

  const scene = episodeData.scenes[index];

  // Reset UI state
  hideEmojiTray();
  hideMic();
  clearFx();

  // Set scene visuals
  setBackground(scene.background || "/assets/backgrounds/bg-puppies.png");
  setDrColi(scene?.drColi?.animation || "idle");
  setBori(scene?.bori?.animation || "idle");

  // Play lines with audio
  const lines = scene?.drColi?.say || [];
  const audioUrls = scene?._audioUrls || [];

  playDialogueWithAudio(lines, audioUrls, async () => {
    enableInteraction(scene.interaction || { type: "none" });
  });
}

// ====== Dialogue + audio ======
function showDialogue(text) {
  dialogueEl.classList.add("active");
  dialogueTextEl.textContent = text;
}
function hideDialogue() {
  dialogueEl.classList.remove("active");
  dialogueTextEl.textContent = "";
}

async function playDialogueWithAudio(lines, audioUrls, onDone) {
  if (!lines || lines.length === 0) {
    hideDialogue();
    onDone?.();
    return;
  }

  let i = 0;

  const next = async () => {
    if (i >= lines.length) {
      hideDialogue();
      onDone?.();
      return;
    }

    const text = String(lines[i] || "").trim();
    const url = audioUrls?.[i] || null;

    // Show text immediately
    showDialogue(text);

    // Play audio if available; otherwise small delay
    if (url) {
      await playAudioUrl(url);
    } else {
      // fallback: readable pause
      await sleep(Math.max(900, Math.min(2400, text.length * 35)));
    }

    // Small beat between lines
    await sleep(250);
    i++;
    next();
  };

  next();
}

function stopAudio() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }
}

function playAudioUrl(url) {
  return new Promise((resolve) => {
    try {
      stopAudio();
      audio = new Audio(url);

      // iOS Safari needs user gesture sometimes — this will still work on desktop.
      audio.onended = () => resolve();
      audio.onerror = () => resolve();

      audio.play().catch(() => {
        // If autoplay blocked, just wait a bit so pacing isn't broken
        resolveAfterDelay(resolve, 1200);
      });
    } catch {
      resolve();
    }
  });
}

function resolveAfterDelay(resolve, ms) {
  setTimeout(() => resolve(), ms);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ====== Interaction ======
function enableInteraction(interaction) {
  if (!interaction || interaction.type === "none") {
    // auto-advance
    setTimeout(() => playScene(currentSceneIndex + 1), 800);
    return;
  }

  if (interaction.type === "emoji") {
    showEmojiTray(interaction.choices || ["🙇‍♀️", "👋", "🏃‍♀️"], interaction.correctIndex ?? 0);
    return;
  }

  if (interaction.type === "mic") {
    showMic();
    return;
  }

  // fallback
  setTimeout(() => playScene(currentSceneIndex + 1), 800);
}

function showEmojiTray(choices, correctIndex) {
  emojiTrayEl.classList.add("active");

  emojiButtons.forEach((btn, idx) => {
    btn.textContent = choices?.[idx] || "";
    btn.onclick = () => {
      const isCorrect = idx === correctIndex;
      if (isCorrect) {
        confettiFullScreen();
        // quick praise moment
        showDialogue("Yes! Great job!");
        setTimeout(() => {
          hideEmojiTray();
          playScene(currentSceneIndex + 1);
        }, 900);
      } else {
        showDialogue("Nice try! Try again!");
        setTimeout(() => {
          // keep tray open
          showDialogue("Pick the best one!");
        }, 700);
      }
    };
  });
}

function hideEmojiTray() {
  emojiTrayEl.classList.remove("active");
  emojiButtons.forEach((btn) => (btn.onclick = null));
}

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

// ====== Confetti (full screen) ======
function confettiFullScreen() {
  clearFx();

  // Use your existing confetti PNG (or swap path if you use a different one)
  // This makes it fall from top to bottom across the whole viewport.
  const img = document.createElement("img");
  img.src = "/assets/ui/confetti-star.png";
  img.alt = "";
  img.style.position = "absolute";
  img.style.left = "0";
  img.style.top = "-20%";
  img.style.width = "100%";
  img.style.height = "auto";
  img.style.opacity = "0.95";
  img.style.pointerEvents = "none";

  // Animation: fall down, then remove
  img.animate(
    [
      { transform: "translateY(0)", opacity: 0.95 },
      { transform: "translateY(140%)", opacity: 0.95 },
      { transform: "translateY(160%)", opacity: 0 }
    ],
    { duration: 1800, easing: "ease-in", fill: "forwards" }
  );

  fxLayer.appendChild(img);

  // Cleanup after animation
  setTimeout(() => clearFx(), 1900);
}

function clearFx() {
  fxLayer.innerHTML = "";
}

// ====== End ======
function endEpisode() {
  hideEmojiTray();
  hideMic();
  hideDialogue();
  clearFx();
  console.log("Episode finished!");
}
