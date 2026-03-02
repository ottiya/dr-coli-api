// api/tts-elevenlabs.js
import crypto from "crypto";
import { head, put } from "@vercel/blob";

export const config = { regions: ["icn1"] }; // optional; you can remove if you want

const ALLOWED_ORIGINS = new Set([
  "https://ottiya.com",
  "https://www.ottiya.com",
  // add your Vercel preview domain(s) if needed:
  // "https://dr-coli-api.vercel.app",
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

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export default async function handler(req, res) {
  try {
    applyCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Use POST" });
    }

    // Safe JSON parse (works if Vercel gives string body)
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const text = String(body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text" });
    if (text.length > 1200) return res.status(400).json({ error: "Text too long (max 1200 chars)" });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

    if (!apiKey || !voiceId) {
      return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID" });
    }

    // Deterministic cache path in Blob
    const key = sha1(`${voiceId}|${modelId}|${text}`);
    const blobPath = `tts-cache/${voiceId}/${modelId}/${key}.mp3`;

    // 1) Cache check: does this mp3 already exist in Blob?
    // head(pathname) returns metadata + url if present. :contentReference[oaicite:1]{index=1}
    try {
      const meta = await head(blobPath);
      if (meta?.url) {
        return res.status(200).json({
          url: meta.url,
          cacheKey: key,
          cached: true,
        });
      }
    } catch (e) {
      // If it doesn't exist, head() throws — that's fine, we generate below.
    }

    // 2) Generate with ElevenLabs
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
          text,
          model_id: modelId,
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
        details: msg.slice(0, 500),
      });
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());

    // 3) Save to Blob under stable pathname.
    // addRandomSuffix:false keeps the pathname stable, and allowOverwrite:false avoids accidental overwrites. :contentReference[oaicite:2]{index=2}
    const blob = await put(blobPath, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    return res.status(200).json({
      url: blob.url,
      cacheKey: key,
      cached: false,
    });
  } catch (err) {
    console.error("tts-elevenlabs error:", err);
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
