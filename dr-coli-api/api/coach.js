export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://ottiya.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { pauseId, choice } = req.body || {};

    const expected = {
      p1: { correct: "안녕하세요", label: "polite hello (annyeonghaseyo)" },
      p2: { correct: "안녕하세요", label: "polite hello with a bow" },
      p3: { correct: "안녕", label: "hello to friends (annyeong)" }
    }[pauseId];

    const system = `
You are Dr. Coli, a friendly broccoli teacher for children ages 6–8.
You teach Korean using English explanations.
You are warm, playful, and encouraging.
Keep responses SHORT (1–2 sentences).
Never mention AI or APIs.
`;

    const user = `
Pause: ${pauseId}
Target: ${expected?.label}
Correct phrase: ${expected?.correct}
Child tapped: ${choice}

Respond as Dr. Coli:
- Praise correct answers
- Gently correct mistakes
- Encourage if unsure
- End with "Let’s keep going!"
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
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

    const data = await r.json();
    const replyText = data.output_text || "Wonderful job! Let’s keep going!";

    res.status(200).json({ replyText });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
}

