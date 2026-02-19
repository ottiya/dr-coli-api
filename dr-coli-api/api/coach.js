// api/coach.js
export default async function handler(req, res) {
  const allowed = new Set([
    "https://ottiya.com",
    "https://www.ottiya.com",
    // dev / preview (optional, remove later)
    "http://localhost:3000",
    "http://localhost:5173",
  ]);

  const origin = req.headers.origin;

  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
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
      p1: { correct: "한국어", label: "how to say Korean language in Korean" },
      p2: { correct: "선생님", label: "how to say teacher in Korean" },
      p3: { correct: "안녕하세요", label: "polite hello (annyeonghaseyo)" },
      p4: { correct: "안녕하세요 with a bow", label: "say 안녕하세요 with a bow (respect)" },
      p5: { correct: "안녕", label: "hello to friends (annyeong)" }
    };

    const expected = expectedMap[pauseId];
    if (!expected) return res.status(400).json({ error: "Unknown pauseId", pauseId });

    const isUnsure =
      /not sure|don't know|dont know|i forgot|forgot|tried/i.test(choice) ||
      choice.length === 0;

    const isCorrect = !isUnsure && choice === expected.correct;

    const interestLine = (() => {
      if (!interest) return "";
      const map = {
        puppies: "Let’s do it like a puppy trainer learning Korean!",
        dinos: "Let’s do it like a dinosaur explorer learning Korean!",
        planes: "Let’s do it like a pilot learning Korean!"
      };
      return map[interest] || "";
    })();

    const nameLine = childName ? `${childName}, ` : "";

    const system = `
You are Dr. Coli, a friendly broccoli teacher for children ages 6–8.
You teach Korean using short, warm English explanations.
Keep responses to 1–2 sentences (max 3).
Never mention AI, APIs, servers, or errors.
Do NOT repeat the same sentence twice.
Always end with: "Let’s keep going!"
`;

    const user = `
Pause: ${pauseId}
Goal: ${expected.label}
Correct phrase: ${expected.correct}
Child tapped: "${choice}"

Classification:
- isCorrect = ${isCorrect}
- isUnsure = ${isUnsure}

Child name (optional): "${childName}"
Interest theme (optional): "${interest}"

Write Dr. Coli's response:
- If isCorrect: praise and confirm why it's right.
- If isUnsure: be supportive and give the correct phrase.
- Else (wrong): say "Nice try!" and give the correct phrase (and 1 tiny hint).
If a name exists, you MAY start with "${nameLine}" but do not overuse it.
If an interest line exists, add it as a final short sentence BEFORE "Let’s keep going!".
Interest line: "${interestLine}"
End with exactly: "Let’s keep going!"
Return plain text only.
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json();

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
          if (typeof c?.text === "string") texts.push(c.text);
        }
      }
      replyText = texts.join("\n").trim();
    }

    if (!replyText) {
      replyText = `Nice try! The right answer is ${expected.correct}. Let’s keep going!`;
    }

    replyText = replyText.replace(/\s+/g, " ").trim();
    const doubled = replyText.match(/^(.+)\s+\1$/);
    if (doubled && doubled[1]) replyText = doubled[1].trim();

    return res.status(200).json({
      replyText,
      debug: { pauseId, choice, isCorrect, isUnsure }
    });
  } catch (e) {
    return res.status(500).json({ error: "Server crashed", details: String(e?.message || e) });
  }
}
