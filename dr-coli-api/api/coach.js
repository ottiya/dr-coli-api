// api/coach.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function safeTrim(s) {
  return String(s || "").trim();
}

function dedupeRepeat(text) {
  const t = safeTrim(text).replace(/\s+/g, " ");

  // Case 1: exact duplication: "A A"
  const m = t.match(/^(.+)\s+\1$/);
  if (m && m[1]) return m[1].trim();

  // Case 2: "A...A..." sometimes comes doubled as two halves
  if (t.length > 40 && t.length % 2 === 0) {
    const half = t.length / 2;
    const a = t.slice(0, half).trim();
    const b = t.slice(half).trim();
    if (a && a === b) return a;
  }
  return t;
}

// Define each pause: correct answer + tiny explanation
const PAUSES = {
  p00: { correct: "한국어", brief: `“한국어” means the Korean language.` },
  p0: { correct: "선생님", brief: `“선생님” means “teacher”.` },
  p1: { correct: "안녕하세요", brief: `“안녕하세요” (annyeonghaseyo) is a polite “hello”.` },
  p2: { correct: "안녕하세요 with a bow", brief: `We bow a little to show respect when we say “안녕하세요”.` },
  p3: { correct: "안녕", brief: `“안녕” is a friendly “hi” for friends.` },
};

function interestLine(interestKey, pauseId) {
  const map = {
    puppies: {
      p00: "Let’s say it like a puppy trainer learning Korean!",
      p0: "Teacher time—like a puppy class!",
      p1: "Say hello like you’re meeting a puppy trainer!",
      p2: "Bow politely like you’re greeting a puppy show judge!",
      p3: "Wave and say hi to your puppy friend!",
    },
    dinos: {
      p00: "Like you’re at a dinosaur museum in Korea!",
      p0: "Teacher time—like a dinosaur science class!",
      p1: "Say hello like you’re meeting a museum guide!",
      p2: "Bow politely like you’re greeting a famous scientist!",
      p3: "Wave and say hi to your dinosaur buddy!",
    },
    planes: {
      p00: "Like you’re at the airport going to Korea!",
      p0: "Teacher time—like flight school!",
      p1: "Say hello like you’re meeting a pilot!",
      p2: "Bow politely like you’re greeting the captain!",
      p3: "Wave and say hi to your airplane toy!",
    },
  };
  return map?.[interestKey]?.[pauseId] || "";
}

export default async function handler(req, res) {
  try {
    // ✅ CORS first (must happen before any return)
    applyCors(req, res);

    // ✅ Preflight support (fixes your “blocked by CORS policy” error)
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const { pauseId, choice, profile } = req.body || {};
    const pId = safeTrim(pauseId);
    const picked = safeTrim(choice);
    const name = safeTrim(profile?.name);
    const interest = safeTrim(profile?.interest);

    if (!pId || !picked) {
      return res.status(400).json({ error: "Missing pauseId or choice" });
    }

    const spec = PAUSES[pId];
    if (!spec) {
      return res.status(400).json({
        error: "Unknown pauseId",
        details: `pauseId "${pId}" not configured on server`,
      });
    }

    const correct = spec.correct;
    const isCorrect = picked === correct;
    const nameBit = name ? `${name}, ` : "";

    const scenario = interestLine(interest, pId);
    const scenarioBit = scenario
      ? `Add this playful line at the end: ${scenario}`
      : "";

    const system = `
You are Dr. Coli, a friendly broccoli teacher for kids ages 6–8 whose first language is English.
Write SHORT feedback (1–3 sentences). Be warm and encouraging.
If incorrect, gently say the correct answer and a tiny explanation. If correct, praise and reinforce meaning.
Do NOT repeat yourself. Do NOT include the same sentence twice.
Do NOT wrap the whole response in quotation marks.
`.trim();

    const user = `
Checkpoint: ${pId}
Child answered: ${picked}
Correct answer: ${correct}

Rules:
- If incorrect → "Nice try" + give correct answer + brief explanation.
- If correct → praise + brief explanation.
- Use the child's name if provided.

Name: ${name || "(none)"}
Brief explanation: ${spec.brief}
${scenarioBit}
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    let replyText = completion.choices?.[0]?.message?.content || "";
    replyText = dedupeRepeat(replyText);

    // Optional subtle name prefix (not always)
    if (nameBit && !replyText.startsWith(nameBit) && Math.random() < 0.35) {
      replyText = `${nameBit}${replyText}`;
    }

    return res.status(200).json({
      replyText,
      isCorrect,
      correctAnswer: correct,
    });
  } catch (err) {
    console.error("coach error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
