/* AI providers: Gemini (free tier) + a deterministic mock for keyless dev. */

export interface AiFood {
  id: string;
  name: string;
  expDate: string;
  daysLeft: number;
}

export const MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

/* Strict structured-output schema — Gemini must return JSON in exactly this
   shape (we still validate server-side as a second line of defense). */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["combined", "single"] },
          usesFoodIds: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          whyThisOne: { type: "string" },
          servings: { type: "integer" },
          times: {
            type: "object",
            properties: { prepMinutes: { type: "integer" }, cookMinutes: { type: "integer" } },
            required: ["prepMinutes", "cookMinutes"],
          },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                trackedFoodId: { type: "string", nullable: true },
                optional: { type: "boolean" },
                measures: {
                  type: "object",
                  properties: {
                    weight: {
                      type: "object",
                      nullable: true,
                      properties: { qty: { type: "number" }, unit: { type: "string" } },
                      required: ["qty", "unit"],
                    },
                    volume: {
                      type: "object",
                      nullable: true,
                      properties: {
                        qty: { type: "number" },
                        unit: { type: "string" },
                        note: { type: "string", nullable: true },
                      },
                      required: ["qty", "unit"],
                    },
                  },
                  required: ["weight", "volume"],
                },
              },
              required: ["name", "trackedFoodId", "optional", "measures"],
            },
          },
          instructions: { type: "array", items: { type: "string" } },
          comments: { type: "string" },
        },
        required: [
          "scope", "usesFoodIds", "title", "whyThisOne", "servings",
          "times", "ingredients", "instructions", "comments",
        ],
      },
    },
  },
  required: ["ideas"],
};

export function buildPrompt(
  foods: AiFood[],
  singleIds: Set<string>,
  priorError?: string | null,
  avoidTitles?: string[]
): string {
  const singleNames = foods.filter((f) => singleIds.has(f.id)).map((f) => f.name);
  return `The user has these foods expiring within the next 7 days (each has an "id" you must reference):
${JSON.stringify(foods, null, 2)}

Create recipe IDEAS for a JSON response with an "ideas" array, containing:
1. Exactly 3 "combined" ideas — complete meals that use as MANY of the listed items together as possible (at least 2 tracked items each, ideally more). Make them varied (different cuisines and cooking methods).
2. Exactly 2 "single" ideas for EACH of these foods: ${singleNames.join(", ")}. Quick, realistic ideas where that food is the star. Set usesFoodIds to just that one food's id.
${avoidTitles && avoidTitles.length ? `
The user already saw and passed on these ideas — do NOT reuse or slightly-renamed-reuse ANY of them. Invent completely different dishes, techniques, and cuisines:
${avoidTitles.map((t) => `- ${t}`).join("\n")}
` : ""}
Rules:
- Pantry staples are assumed on hand: oil, butter, salt, pepper, soy sauce, vinegar, sugar, honey, flour, rice, pasta, oats, common spices, onions, garlic, lemons. Only list other ingredients that are truly needed, always with amounts.
- Every ingredient needs BOTH measures where sensible: "volume" in US units (cups/tbsp/tsp, or counting units like qty:2 unit:"cloves" or qty:2 unit:"medium") and "weight" in metric (g or ml). Use null for whichever genuinely doesn't apply. Put prep notes like "diced" in volume.note.
- For an ingredient that IS one of the user's tracked foods, set trackedFoodId to that food's EXACT id string (copy it character-for-character). For pantry/other ingredients set trackedFoodId to null.
- times are whole minutes; servings should be realistic (2-6).
- "whyThisOne": one short friendly sentence about what food it uses up.
- "comments": one short practical tip (substitution, storage, scaling).
- Do NOT suggest ideas that require an air fryer unless mentioned; standard stove/oven tools only.
${priorError ? `\nYour previous attempt failed validation: ${priorError}. Fix it and return corrected JSON only.\n` : ""}
Return ONLY the JSON object matching the schema — no markdown fences, no commentary.`;
}

/** Call Gemini with structured output enforced via responseSchema. */
export async function generateWithGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    // hard cap so an overloaded/slow API can never wedge generation forever
    signal: AbortSignal.timeout(70_000),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: 'You are a creative, practical home-cook assistant inside "SnackTime", an app that helps people eat their food before it goes bad. You always reply with ONLY a JSON object matching the required schema — no markdown, no commentary.',
        }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

/* ── Mock generator (no API key needed — for UI dev / offline) ────────── */

const COMBINED_TEMPLATES = [
  { title: (a: string, b: string) => `One-Pan ${a} & ${b} Skillet`, cuisine: "a cozy one-pan dinner" },
  { title: (a: string, b: string) => `${a} Stir-Fry over Rice`, cuisine: "a fast weeknight stir-fry" },
  { title: (a: string, b: string) => `Rustic ${a} Bowls with ${b}`, cuisine: "a build-your-own bowl" },
];

const SINGLE_TEMPLATES = [
  (name: string) => `${name} Fried Rice`,
  (name: string) => `Sheet-Pan ${name}`,
];

function measureFor(seed: number): {
  weight: { qty: number; unit: string };
  volume: { qty: number; unit: string; note: string };
} {
  const vols = [
    { qty: 1, unit: "cup", note: "chopped" },
    { qty: 1.5, unit: "cups", note: "sliced" },
    { qty: 2, unit: "cups", note: "cut up" },
  ];
  const volsG = [150, 225, 300];
  const i = seed % 3;
  return { weight: { qty: volsG[i], unit: "g" }, volume: { ...vols[i] } };
}

function mockInstructions(name: string, style: string): string[] {
  return [
    `Prep your ${name.toLowerCase()}: rinse, dry, and cut into bite-size pieces.`,
    style === "stir"
      ? "Heat oil in a large pan over high heat; sauté aromatics (onion, garlic) until fragrant, about 2 minutes."
      : "Heat oil in a large oven-safe pan over medium-high heat.",
    `Add the ${name.toLowerCase()} and cook until just tender and lightly browned, 5-7 minutes.`,
    "Season with salt, pepper, and a splash of soy sauce or a squeeze of lemon to taste.",
    "Serve hot over rice, pasta, or crusty bread. Taste and adjust seasoning before serving.",
  ];
}

function baseIngredients(food: AiFood, seed: number) {
  return [
    { name: food.name, trackedFoodId: food.id, optional: false, measures: measureFor(seed) },
    { name: "cooked rice", trackedFoodId: null, optional: false, measures: { weight: { qty: 300, unit: "g" }, volume: { qty: 2, unit: "cups", note: "cooked" } } },
    { name: "onion", trackedFoodId: null, optional: false, measures: { weight: { qty: 110, unit: "g" }, volume: { qty: 1, unit: "medium", note: "diced" } } },
    { name: "garlic", trackedFoodId: null, optional: true, measures: { weight: { qty: 6, unit: "g" }, volume: { qty: 2, unit: "cloves", note: null } } },
  ];
}

/** Deterministic placeholder ideas so the UI works without an API key. */
export function generateWithMock(foods: AiFood[]): string {
  const ideas: unknown[] = [];
  const names = foods.map((f) => f.name);
  const a = names[0] ?? "veg";
  const b = names[1] ?? names[0] ?? "grain";

  COMBINED_TEMPLATES.forEach((t, i) => {
    const uses = foods.slice(0, Math.min(foods.length, i === 0 ? 3 : 2));
    ideas.push({
      scope: "combined",
      usesFoodIds: uses.map((f) => f.id),
      title: t.title(a, b),
      whyThisOne: `Uses up ${uses.map((f) => f.name.toLowerCase()).join(" and ")} in ${t.cuisine}.`,
      servings: 4,
      times: { prepMinutes: 10 + i * 5, cookMinutes: 20 + i * 5 },
      ingredients: [
        ...uses.map((f, j) => ({
          name: f.name, trackedFoodId: f.id, optional: false, measures: measureFor(i + j),
        })),
        { name: "cooked rice", trackedFoodId: null, optional: false, measures: { weight: { qty: 450, unit: "g" }, volume: { qty: 3, unit: "cups", note: "cooked" } } },
      ],
      instructions: mockInstructions(a, i === 1 ? "stir" : "pan"),
      comments: "Mock idea — add a GEMINI_API_KEY in server/.env for real AI recipes.",
    });
  });

  for (const f of foods) {
    SINGLE_TEMPLATES.forEach((t, i) => {
      ideas.push({
        scope: "single",
        usesFoodIds: [f.id],
        title: t(f.name),
        whyThisOne: `An easy way to use up your ${f.name.toLowerCase()} before it turns.`,
        servings: 2,
        times: { prepMinutes: 5 + i * 5, cookMinutes: 15 + i * 10 },
        ingredients: baseIngredients(f, i),
        instructions: mockInstructions(f.name, i === 0 ? "stir" : "pan"),
        comments: "Mock idea — add a GEMINI_API_KEY in server/.env for real AI recipes.",
      });
    });
  }

  return JSON.stringify({ ideas });
}
