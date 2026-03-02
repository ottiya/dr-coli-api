// api/tts-elevenlabs.js
import crypto from "crypto";
import { put } from "@vercel/blob";

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

    // 👇 THIS is the important new knob
    const styleVersion = process.env.TTS_STYLE_VERSION || "v1";

    if (!apiKey || !voiceId) {
      return res.status(500).json({ error: "Missing ElevenLabs env vars" });
    }

    const cleanText = text.trim();

    // 🔑 Cache key now includes style version
    const key = sha1(
      `${voiceId}|${modelId}|${styleVersion}|${cleanText}`
    );

    const blobPath = `tts-cache/${voiceId}/${modelId}/${styleVersion}/${key}.mp3`;

    // Call ElevenLabs
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: modelId,

          // Tuned to be faster + more energetic
          voice_settings: {
            stability: 0.28,
            similarity_boost: 0.88,
            style: 0.55,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenRes.ok) {
      const msg = await elevenRes.text().catch(() => "");
      return res.status(502).json({
        error: "ElevenLabs TTS failed",
        status: elevenRes.status,
        details: msg.slice(0, 300),
      });
    }

    const audioArrayBuffer = await elevenRes.arrayBuffer();
    const audioBuffer = Buffer.from(audioArrayBuffer);

    // Save to Blob (public, CDN cached)
    const blob = await put(blobPath, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });

    return res.status(200).json({
      url: blob.url,
      cacheKey: key,
      styleVersion,
    });
  } catch (err) {
    console.error("TTS error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
