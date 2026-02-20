// api/tts.js

export const config = { regions: ["icn1"] };

const ALLOWED_ORIGINS = new Set([
  "https://ottiya.com",
  "https://www.ottiya.com",
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Best-effort warm cache
const CACHE = new Map();
const CACHE_MAX = 120;

function cacheGet(key) {
  return CACHE.get(key);
}
function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX) {
    const firstKey = CACHE.keys().next().value;
    if (firstKey) CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
}

export default async function handler(req, res) {
  try {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    // Parse body safely (handles string body too)
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const input = String(body?.text || "").trim();
    if (!input) {
      return res.status(400).json({ error: "Missing text" });
    }

    if (input.length > 800) {
      return res.status(400).json({ error: "Text too long (max 800 chars)" });
    }

    const cacheKey = input;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-TTS-Cache", "HIT");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(cached);
    }

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "shimmer",
        input,
        format: "mp3",
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({
        error: "TTS upstream error",
        status: r.status,
        details: detail?.slice(0, 800),
      });
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    cacheSet(cacheKey, buffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-TTS-Cache", "MISS");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(buffer);
  } catch (e) {
    console.error("tts error:", e);
    res.status(500).json({ error: "TTS error", details: String(e?.message || e) });
  }
}
