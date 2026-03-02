// api/stt.js
// Speech-to-text using OpenAI Audio Transcriptions
// Docs: /v1/audio/transcriptions supports gpt-4o-mini-transcribe, gpt-4o-transcribe, whisper-1. :contentReference[oaicite:1]{index=1}

export const config = {
  api: {
    bodyParser: false, // we handle multipart ourselves
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Use POST" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);

    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    // Forward to OpenAI as-is (multipart)
    const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": contentType,
      },
      body: bodyBuffer,
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return res.status(502).json({
        error: "OpenAI STT failed",
        status: openaiRes.status,
        details: detail.slice(0, 800),
      });
    }

    const data = await openaiRes.json();
    return res.status(200).json({ text: data?.text || "" });
  } catch (err) {
    console.error("stt error:", err);
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
