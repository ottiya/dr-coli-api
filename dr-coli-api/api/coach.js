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
    const firstKey = CACHE.keys().next().value;
    if (firstKey) CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
}

// Normalize STT quirks (spaces, punctuation, fullwidth punctuation)
function norm(s) {
  return String(s || "")
    .replace(/\s+/g, "")              // remove spaces: "안 녕 하 세 요" -> "안녕하세요"
    .replace(/[.?!,，。！？]/g, "")     // remove punctuation
    .trim();
}

// If the model ever adds a trailing question (or another prompt), strip it when correct.
// (We keep "Let’s keep going!" because your UI/flow expects it.)
function stripTrailingQuestions(text) {
  let t = String(text || "").trim();

  // While the reply ends with a question, remove the last sentence-ish chunk.
  while (/\?\s*$/.test(t)) {
    const idx = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "));
    if (idx === -1) return "";
    t = t.slice(0, idx + 1).trim();
  }

  return t;
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

    // Keep both: raw for display/unsure detection, normalized for matching
    const choiceRaw = String(body.choice || "").trim();
    const choiceNorm = norm(choiceRaw);

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
      p4: { correct: "안녕하세요", label: "say 안녕하세요 with respect (a bow)" },
      p5: { correct: "안녕", label: "hello to friends" },
    };

    const expected = expectedMap[pauseId];
    if (!expected) return res.status(400).json({ error: "Unknown pauseId", pauseId });

    // Normalize expected too (important for STT punctuation/spacing)
    const expectedNorm = norm(expected.correct);

    // ---- Deterministic correctness ----
    const isUnsure =
      /not sure|don't know|dont know|i forgot|forgot|tried/i.test(choiceRaw) ||
      choiceRaw.length === 0;

    const isCorrect = !isUnsure && choiceNorm === expectedNorm;

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

    // ---- Cache key (avoid repeats during demo) ----
    // Use normalized choice so "안녕하세요!" and "안녕하세요" share cache
    const cacheKey = JSON.stringify({
      p: pauseId,
      c: choiceNorm,
      n: childName ? 1 : 0,
      i: interest || "",
      ok: isCorrect ? 1 : 0,
      un: isUnsure ? 1 : 0,
    });

    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({
        replyText: cached,
        debug: {
          pauseId,
          choiceRaw,
          choiceNorm,
          expected: expected.correct,
          isCorrect,
          isUnsure,
          cached: true,
        },
      });
    }

    // ---- Smaller prompt = faster ----
    // ✅ Key changes:
    //  - If correct: MUST NOT ask a question or introduce a new prompt/scenario.
    //  - If not correct: MUST end with a short question inviting the child to try again.
    //  - Always end with "Let’s keep going!" (your UI expects it).
    const system =
      "You are Dr. Coli, a friendly broccoli teacher for kids 6–8. " +
      "Respond in warm, simple English. 1–2 sentences (max 3). " +
      "Never mention AI or tech. Do not repeat yourself. " +
      "If isCorrect=true: DO NOT ask any question and do NOT introduce a new prompt. " +
      "If isCorrect=false: You MAY end with one short question inviting the child to try again. " +
      'End with exactly: "Let’s keep going!"';

    // ✅ Tell the model what *exact structure* to use.
    const user =
      `Pause ${pauseId}. Goal: ${expected.label}. Correct: ${expected.correct}. ` +
      `Child said/tapped: "${choiceRaw}". (Normalized: "${choiceNorm}") ` +
      `isCorrect=${isCorrect}. isUnsure=${isUnsure}. ` +
      (childName ? `Name: ${childName}. ` : "") +
      (interestLine ? `Theme word: ${interestLine}. ` : "") +
      `Rules:\n` +
      `- If correct: praise + confirm meaning. NO question. NO new scenario. Stop after encouragement.\n` +
      `- If unsure: encourage + give correct phrase + meaning.\n` +
      `- If wrong: say "Nice try!" + give correct phrase + meaning + one tiny hint.\n` +
      `- If you use the name, start with "${namePrefix}" (don’t overuse).\n` +
      (interestLine ? `- Include "${interestLine}" as a very short sentence before the ending.\n` : "") +
      `Return plain text only.`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_output_tokens: 70, // shorter output = lower latency
        temperature: 0.35,
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
      // fallback (still follows “no question when correct”)
      replyText = isCorrect
        ? `You got it! "${expected.correct}" is correct. Let’s keep going!`
        : `Nice try! The right answer is ${expected.correct}. Want to try it again? Let’s keep going!`;
    }

    // Normalize whitespace
    replyText = replyText.replace(/\s+/g, " ").trim();

    // ✅ If correct, forcibly remove any trailing question that slipped through.
    if (isCorrect) {
      const cleaned = stripTrailingQuestions(replyText);
      if (cleaned) replyText = cleaned;
    }

    // Enforce ending for consistency
    if (!replyText.endsWith("Let’s keep going!")) {
      replyText = replyText.replace(/[.!?]*\s*$/, "").trim() + ". Let’s keep going!";
    }

    // ✅ After enforcing ending, re-check: if correct, still no question before the ending.
    if (isCorrect && /\?\s*Let’s keep going!\s*$/.test(replyText)) {
      // Remove the question sentence right before the ending.
      const beforeEnding = replyText.replace(/\s*Let’s keep going!\s*$/, "").trim();
      const cleaned = stripTrailingQuestions(beforeEnding);
      replyText = (cleaned || beforeEnding).replace(/[.!?]*\s*$/, "").trim() + ". Let’s keep going!";
    }

    // Remove rare exact duplication
    const doubled = replyText.match(/^(.+)\s+\1$/);
    if (doubled && doubled[1]) replyText = doubled[1].trim();

    // Cache it (best effort)
    cacheSet(cacheKey, replyText);

    return res.status(200).json({
      replyText,
      debug: {
        pauseId,
        choiceRaw,
        choiceNorm,
        expected: expected.correct,
        isCorrect,
        isUnsure,
        cached: false,
      },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Server crashed", details: String(e?.message || e) });
  }
}
