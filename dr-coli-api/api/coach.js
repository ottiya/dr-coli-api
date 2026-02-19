export default async function handler(req, res) {
  // ---- CORS (allow ottiya + www) ----
  const allowed = new Set(["https://ottiya.com", "https://www.ottiya.com"]);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // Vercel sometimes gives req.body as string depending on runtime/settings
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const pauseId = body.pauseId;
    const choice = (body.choice || "").trim();

    if (!pauseId) return res.status(400).json({ error: "Missing pauseId" });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });

    // ---- Expected answers ----
    const expectedMap = {
      p1: { correct: "안녕하세요", label: "polite hello (annyeonghaseyo)" },
      p2: { correct: "안녕하세요", label: "polite hello with a bow" },
      p3: { correct: "안녕", label: "hello to friends (annyeong)" }
    };

    const expected = expectedMap[pauseId];
    if (!expected) return res.status(400).json({ error: "Unknown pauseId" });

    // ---- Deterministic correctness ----
    const isUnsure =
      /not sure|don't know|dont know|tried/i.test(choice) ||
      choice.length === 0;

    const isCorrect = !isUnsure && choice === expected.correct;

    // ---- Prompt ----
    const system = `
You are Dr. Coli, a friendly broccoli teacher for children ages 6–8.
You teach Korean using short, warm English explanations.
Keep responses to 1–2 sentences.
Never mention AI, APIs, servers, or errors.
If the child is wrong, gently correct them and give the right phrase.
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

Write Dr. Coli's response:
- If isCorrect: praise and confirm why it's right.
- If isUnsure: be supportive and give the correct phrase.
- Else (wrong): say "Nice try!" and give the correct phrase (and 1 tiny hint).
End with: "Let’s keep going!"
Return plain text only.
`;

    // ---- Call OpenAI Responses API ----
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
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
      const errText = await r.text();
      return res.status(500).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json();

    // ---- Robust text extraction (prevents fallback always happening) ----
    let replyText = "";

    // Sometimes this exists:
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      replyText = data.output_text.trim();
    }

    // Otherwise extract from output[].content[]
    if (!replyText && Array.isArray(data.output)) {
      const texts = [];
      for (const item of data.output) {
        if (!item?.content) continue;
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") texts.push(c.text);
          if (typeof c?.text === "string") texts.push(c.text); // extra safety
        }
      }
      replyText = texts.join("\n").trim();
    }

    // Final fallback (should be rare now)
    if (!replyText) replyText = "Nice try! The right answer is " + expected.correct + ". Let’s keep going!";

    return res.status(200).json({ replyText, debug: { pauseId, choice, isCorrect, isUnsure } });
  } catch (e) {
    return res.status(500).json({ error: "Server crashed", details: String(e) });
  }
}
