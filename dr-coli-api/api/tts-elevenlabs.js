// /api/tts-elevenlabs.js
import crypto from "crypto";
import { put, head } from "@vercel/blob";

export const config = {
  api: {
    bodyParser: true,
  },
};

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
    const styleVersion = process.env.TTS_STYLE_VERSION || "v1";

    if (!apiKey || !voiceId) {
      return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID" });
    }

    const cleanText = text.trim();

    // Include style + voice + model in cache key
    const key = sha1(`${voiceId}|${modelId}|${styleVersion}|${cleanText}`);
    const blobPath = `tts-cache/${voiceId}/${modelId}/${styleVersion}/${key}.mp3`;

    // ✅ 1) FAST PATH: if blob already exists, return it immediately
    try {
      const meta = await head(blobPath);
      if (meta?.url) {
        return res.status(200).json({
          url: meta.url,
          cacheKey: key,
          styleVersion,
          cached: true,
        });
      }
    } catch {
      // If it doesn't exist or head fails, continue to generate
    }

    // ✅ 2) Generate audio from ElevenLabs
    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: modelId,

        // Good for English-speaking kids learning Korean:
        // - slightly lower stability = more expressive
        // - keep similarity high = stays “Dr. Coli”
        voice_settings: {
          stability: 0.32,
          similarity_boost: 0.88,
          style: 0.55,
          use_speaker_boost: true,
        },
      }),
    });

    if (!elevenRes.ok) {
      const msg = await elevenRes.text().catch(() => "");
      return res.status(502).json({
        error: "ElevenLabs TTS failed",
        status: elevenRes.status,
        details: msg.slice(0, 800),
      });
    }

    const audioArrayBuffer = await elevenRes.arrayBuffer();
    const audioBuffer = Buffer.from(audioArrayBuffer);

    // ✅ 3) Save to Blob (public)
    const blob = await put(blobPath, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });

    return res.status(200).json({
      url: blob.url,
      cacheKey: key,
      styleVersion,
      cached: false,
    });
  } catch (err) {
    console.error("TTS error:", err);
    return res.status(500).json({
      error: "Server error",
      details: String(err?.message || err),
    });
  }
}
