export default async function handler(req, res) {
  const allowed = new Set([
  "https://ottiya.com",
  "https://www.ottiya.com"
]);

const origin = req.headers.origin;
if (allowed.has(origin)) {
  res.setHeader("Access-Control-Allow-Origin", origin);
}

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { text } = req.body || {};

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: text,
        format: "mp3"
      })
    });

    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(buffer);
  } catch (e) {
    res.status(500).json({ error: "TTS error", details: String(e) });
  }
}
