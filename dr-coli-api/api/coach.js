// api/coach.js

// Pin close to Korea/Asia users
export const config = { regions: ["icn1"] };

// Best-effort in-memory cache (persists only while the function instance is warm)
const CACHE = new Map();
const CACHE_MAX = 200;

function cacheGet(key) {
  return CACHE.get(key);
}
function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX) {
    // delete oldest entry
    const firstKey = CACHE.keys().next().value;
    if (firstKey) CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
}

export default async function handler(req, res) {
  // ---- CORS (allow ottiya + www) ----
  const allowed = new Set(["https://ottiya.com", "https://www.ottiya.com"]);
  const origin = req.headers.origin;

  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Parse body safely
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  try {
    const pauseId = (body.pauseId || "").trim();
    const choice = (body.choice || "").trim();
    const profile = body.profile || {};
    const childName = (profile.name || "").trim();
    const interest = (profile.interest || "").trim();

    if (!pauseId) return res.status(400).json({ error: "Missing pauseId" });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });
    }

    // ---- Expected answers (RENUMBERED p1..p5) ----
    const expectedMap = {
      p1: { correct: "한국어", label: "say 'Korean language' in Korean" },
      p2: { correct: "선생님", label: "say 'teacher' in Korean" },
      p3: { correct: "안녕하세요", label: "polite hello" },
      p4: { correct: "안녕하세요 with a bow", label: "say 안녕하세요 with respect (a bow)" },
      p5: { correct: "안녕", label: "hello to friends" },
    };

    const expected = expectedMap[pauseId];
    if (!expected) return res.status(400).json({ error: "Unknown pauseId", pauseId });

    // ---- Deterministic correctness ----
    const isUnsure =
      /not sure|don't know|dont know|i forgot|forgot|tried/i.test(choice) ||
      choice.length === 0;

    const isCorrect = !isUnsure && choice === expected.correct;

    // ---- Optional personalization line ----
    const interestLine = (() => {
      if (!interest) return "";
      const map = {
        puppies: "Puppy power!",
        dinos: "Dino power!",
        planes: "Pilot power!",
      };
      return map[interest] || "";
    })();

    const namePrefix = childName ? `${childName}, ` : "";

    // ---- Cache key (still uses OpenAI; just avoids repeats during demo) ----
    // Keep key stable & small
    const cacheKey = JSON.stringify({
      p: pauseId,
      c: choice,
      n: childName ? 1 : 0,
      i: interest || "",
      ok: isCorrect ? 1 : 0,
      un: isUnsure ? 1 : 0,
    });

    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({
        replyText: cached,
        debug: { pauseId, choice, isCorrect, isUnsure, cached: true },
      });
    }

    // ---- Smaller prompt = faster ----
    const system =
      "You are Dr. Coli, a friendly broccoli teacher for kids 6–8. " +
      "Respond in warm, simple English. 1–2 sentences (max 3). " +
      "Never mention AI or tech. Do not repeat yourself. " +
      'End with exactly: "Let’s keep going!"';

    const user =
      `Pause ${pauseId}. Goal: ${expected.label}. Correct: ${expected.correct}. ` +
      `Child tapped: "${choice}". isCorrect=${isCorrect}. isUnsure=${isUnsure}. ` +
      (childName ? `Name: ${childName}. ` : "") +
      (interestLine ? `Theme word: ${interestLine}. ` : "") +
      `Rules: If correct, praise + confirm. If unsure, encourage + give correct phrase. ` +
      `If wrong, say "Nice try!" + give correct phrase + one tiny hint. ` +
      `If you use the name, start with "${namePrefix}" (don’t overuse). ` +
      (interestLine ? `Include "${interestLine}" as a very short sentence before the ending. ` : "") +
      `Return plain text only.`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // Shorter output = lower latency
        max_output_tokens: 70,
        temperature: 0.4,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json();

    // ---- Robust text extraction ----
    let replyText = "";
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      replyText = data.output_text.trim();
    }

    if (!replyText && Array.isArray(data.output)) {
      const texts = [];
      for (const item of data.output) {
        if (!item?.content) continue;
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") texts.push(c.text);
          else if (typeof c?.text === "string") texts.push(c.text);
        }
      }
      replyText = texts.join("\n").trim();
    }

    if (!replyText) {
      replyText = `Nice try! The right answer is ${expected.correct}. Let’s keep going!`;
    }

    // Normalize whitespace
    replyText = replyText.replace(/\s+/g, " ").trim();

    // Enforce ending for consistency
    if (!replyText.endsWith("Let’s keep going!")) {
      replyText = replyText.replace(/[.!?]*\s*$/, "").trim() + ". Let’s keep going!";
    }

    // Remove rare exact duplication
    const doubled = replyText.match(/^(.+)\s+\1$/);
    if (doubled && doubled[1]) replyText = doubled[1].trim();

    // Cache it (best effort)
    cacheSet(cacheKey, replyText);

    return res.status(200).json({
      replyText,
      debug: { pauseId, choice, isCorrect, isUnsure, cached: false },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Server crashed", details: String(e?.message || e) });
  }
}
