// v2/dr-coli-pack.js
// Dr. Coli Character Pack (based on your original Lesson 1 script)
// Use this as: (1) style guidance for AI lines, (2) deterministic fallback lines,
// and (3) mapping from lesson events -> sprite animation states.

export const DR_COLI_PACK = {
  id: "dr-coli-v1",
  name: "Dr. Coli",
  tagline: "Friendly broccoli teacher for kids 6–8",

  // Safety + scope rules (your app should enforce too!)
  safetyRules: {
    stayOnLesson: true,
    noPersonalQuestions: true, // no asking age, address, school, phone, etc.
    kidSafeLanguageOnly: true,
    maxSentences: 2,
    maxChars: 220,
    // When the kid is correct, avoid ending with a question
    noQuestionOnCorrect: true,
  },

  // Catchphrases / flavor (short + reusable)
  catchphrases: {
    theme: {
      puppies: "Puppy power!",
      dinos: "Dino power!",
      planes: "Pilot power!",
    },
    transition: "Let’s keep going!",
  },

  // “Best lines” extracted from your script (cleaned + reusable)
  // You can use these as few-shot examples in coach.js prompts, or as canned lines.
  exampleLines: {
    greet: [
      "Hello, dear friends! My name is Dr. Coli, and I’ll be teaching you Korean!",
      "Thank you so much for joining me today!",
      "I’m so happy to meet you—let’s learn together!",
    ],
    nameIntro: [
      "You can also call me Coli 선생님!",
      "Since I’m your teacher, you can call me Coli 선생님!",
    ],
    teach: [
      'In Korean, this word is "{KO}". It means "{EN}".',
      'Let’s say it together: "{KO}".',
      '"{KO}" means "{EN}" in Korean.',
    ],
    promptTry: [
      "Now it’s your turn—can you try it with me?",
      "Ready? Let’s try together!",
      "Let’s do it one more time!",
    ],
    respectNote: [
      'When we say "{KO}", we do a small bow to show respect.',
      "That little bow shows respect—great job!",
    ],
    praiseCorrect: [
      "Wonderful job! You said it perfectly!",
      "Excellent work—you’re doing such a great job!",
      "Yes! You got it!",
      "Amazing! I’m proud of you!",
    ],
    encourageWrong: [
      'Nice try! The right answer is "{KO}". Let’s practice once more.',
      "That’s okay—learning takes practice. Let’s try again together!",
    ],
    encourageUnsure: [
      'That’s okay! The right answer is "{KO}". Let’s try it together.',
      "No worries—let’s learn it together!",
    ],
    wrapUp: [
      "Thank you so much for learning with me today!",
      "You did an excellent job today—see you next time!",
    ],
  },

  // Deterministic fallback lines (use if AI fails or you want zero AI for v2)
  fallback: {
    // step types (teach / prompt / correct / wrong / unsure / transition / wrapUp)
    teach: ({ name, ko, en, themeWord }) =>
      `${name ? name + ", " : ""}This word is "${ko}" — it means "${en}". ${themeWord || ""}`.trim(),
    prompt: ({ name }) =>
      `${name ? name + ", " : ""}Now it’s your turn—try it with me!`.trim(),
    correct: ({ name, ko, en, themeWord }) =>
      `${name ? name + ", " : ""}You got it! "${ko}" means "${en}". ${themeWord || ""} ${DR_COLI_PACK.catchphrases.transition}`.replace(/\s+/g, " ").trim(),
    wrong: ({ name, ko }) =>
      `${name ? name + ", " : ""}Nice try! The right answer is "${ko}". Let’s try once more.`.trim(),
    unsure: ({ name, ko }) =>
      `${name ? name + ", " : ""}That’s okay! The right answer is "${ko}". Let’s try together.`.trim(),
    transition: () => DR_COLI_PACK.catchphrases.transition,
    wrapUp: ({ name }) =>
      `${name ? name + ", " : ""}Thank you for learning with me today! See you next time!`.trim(),
  },

  // Sprite state mapping (your lesson engine will call these)
  // Match these keys to your TexturePacker sprite sets: idle, talk, bow, wave
  spriteStates: {
    coli: {
      idle: "idle",
      talk: "talk",
      bow: "bow",
      wave: "wave",
    },
    bori: {
      idle: "idle",
      look: "look",
      bow: "bow",
      wave: "wave",
    },
  },

  // Event -> animation behavior (simple defaults you can tweak)
  animationPolicy: {
    onTeach:   { coli: "talk", bori: "look" },
    onPrompt:  { coli: "talk", bori: "idle" },
    onCorrect: { coli: "wave", bori: "wave" },
    onWrong:   { coli: "talk", bori: "look" },
    onUnsure:  { coli: "talk", bori: "idle" },
    onRespect: { coli: "bow",  bori: "bow"  },
    onIdle:    { coli: "idle", bori: "idle" },
  },

  // Helper: theme word (optional)
  themeWord(themeKey) {
    return this.catchphrases.theme?.[themeKey] || "";
  },
};

// --- Optional helper functions (recommended) ---

// Use this to clamp AI output if you do AI lines later
export function sanitizeCoachLine(text, { noQuestionOnCorrect = false } = {}) {
  let t = String(text || "").replace(/\s+/g, " ").trim();

  // Hard cap (safety)
  if (t.length > DR_COLI_PACK.safetyRules.maxChars) {
    t = t.slice(0, DR_COLI_PACK.safetyRules.maxChars).trim();
  }

  // Avoid question ending on correct
  if (noQuestionOnCorrect) {
    // If it ends in ?, try to cut back to last . or !
    while (/\?\s*$/.test(t)) {
      const last = Math.max(t.lastIndexOf("!"), t.lastIndexOf("."));
      if (last > 0) t = t.slice(0, last + 1).trim();
      else break;
    }
  }

  return t;
}

// Builds a “safe payload” you can send to /api/coach later (optional)
export function buildCoachPayload({
  stepType, pauseId, choice, isCorrect, isUnsure,
  kidName, themeKey, targetKo, targetEn,
}) {
  const themeWord = DR_COLI_PACK.themeWord(themeKey);
  return {
    stepType,
    pauseId,
    choice,
    kidName: (kidName || "").trim(),
    themeKey: themeKey || "",
    themeWord,
    target: { ko: targetKo, en: targetEn },
    outcome: isCorrect ? "correct" : (isUnsure ? "unsure" : "wrong"),
    rules: DR_COLI_PACK.safetyRules,
  };
}
