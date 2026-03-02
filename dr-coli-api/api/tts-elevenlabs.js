// api/tts.js
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
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Missing text" });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

    if (!apiKey || !voiceId) {
      return res.status(500).json({ error: "Missing ElevenLabs env vars" });
    }

    // Cache key: same text + same voice + same model => same file
    const cleanText = text.trim();
    const key = sha1(`${voiceId}|${modelId}|${cleanText}`);

    // Store under a predictable path
    const blobPath = `tts-cache/${voiceId}/${modelId}/${key}.mp3`;

    // Try to "put" with overwrite:false-ish behavior:
    // Vercel Blob doesn't have a simple "exists" call without listing,
    // so we do a cheap strategy:
    // - Attempt to generate and put (content-addressed)
    // - If the URL already exists in Blob (same path), overwrite is harmless for same content.
    // If you want stricter "exists", we can add list() later.

    // Call ElevenLabs TTS
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
          // You can tune voice settings later
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.2,
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

    // Save to Blob (public URL returned)
    const blob = await put(blobPath, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false, // important: path stays stable for caching
    });

    return res.status(200).json({
      url: blob.url,
      cacheKey: key,
    });
  } catch (err) {
    console.error("TTS error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
