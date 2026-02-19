// api/tts.js
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

export default async function handler(req, res) {
  try {
    // ✅ CORS first
    applyCors(req, res);

    // ✅ Preflight
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const { text } = req.body || {};
    const input = String(text || "").trim();

    if (!input) {
      return res.status(400).json({ error: "Missing text" });
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

    // If OpenAI returns error, forward it (super helpful for debugging)
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({
        error: "TTS upstream error",
        status: r.status,
        details: detail?.slice(0, 800),
      });
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(buffer);
  } catch (e) {
    console.error("tts error:", e);
    res.status(500).json({ error: "TTS error", details: String(e?.message || e) });
  }
}
