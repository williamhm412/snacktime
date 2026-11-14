/* SnackTime API core — runs on Cloudflare Pages Functions (Workers runtime).
   Same logic as the original Express server, but stateless: data lives in
   Workers KV instead of the local filesystem. */

export interface Env {
  SNACKTIME_DB: KVNamespace;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface FoodItem {
  id: string;
  name: string;
  expDate: string; // YYYY-MM-DD
  addedAt: string; // ISO
}

export type SortMode = "added" | "expiry";

export interface Measure { qty: number; unit: string; note?: string | null }

export interface Ingredient {
  name: string;
  trackedFoodId: string | null;
  optional: boolean;
  measures: { weight: Measure | null; volume: Measure | null };
}

export interface RecipeIdea {
  set: "expiring" | "pantry"; // which tab this idea belongs to
  scope: "combined" | "single";
  usesFoodIds: string[];
  title: string;
  whyThisOne: string;
  servings: number;
  times: { prepMinutes: number; cookMinutes: number };
  ingredients: Ingredient[];
  instructions: string[];
  comments: string;
}

export interface IdeasDoc {
  generatedAt: string;
  generator: string;
  foodSnapshot: string[]; // ALL pantry ids (stale check when the list changes)
  expiringSnapshot: string[]; // ids expiring within 7 days
  ideas: RecipeIdea[];
}

export interface IdeasView {
  status: "ok" | "generating" | "empty";
  generating: boolean;
  cache: IdeasDoc | null;
  error: string | null;
}

export interface RefreshResult {
  view: IdeasView;
  /** true = ideas are stale and nobody is generating: client should POST /api/ideas/generate */
  startGeneration: boolean;
}

/* ── User scope (temporary multi-user: one set of KV keys per person) ─── */
/* Named users persist on any device. Guest = throwaway id held only in the
   browser's sessionStorage + KV entries with a TTL, so closing the page or
   waiting 12h wipes everything. NOTE: courtesy divider, not security. */

export const NAMED_USERS = ["william", "ammon", "mckay", "dr-lignell"] as const;
export const GUEST_TTL_SECONDS = 12 * 3600;

export interface Scope {
  user: string; // "william" | ... | "guest:<random id>"
  ttl?: number; // guests only: KV entries auto-expire
}

/** Turn the X-Snacktime-User header into a Scope, or null if not recognized. */
export function parseUser(raw: string | null): Scope | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if ((NAMED_USERS as readonly string[]).includes(v)) return { user: v };
  if (/^guest:[a-z0-9-]{6,40}$/.test(v)) return { user: v, ttl: GUEST_TTL_SECONDS };
  return null;
}

/* ── KV helpers (all keys are scoped per user) ─────────────────────────── */

const kFoods = (s: Scope) => `foods:${s.user}`;
const kIdeas = (s: Scope) => `ideas:${s.user}`;
const kIdeasLock = (s: Scope) => `ideas:status:${s.user}`; // exists while a generation is running (TTL guards zombies)
const kIdeasError = (s: Scope) => `ideas:error:${s.user}`;
const kOutbox = (s: Scope) => `outbox:latest:${s.user}`;

async function readJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const raw = await env.SNACKTIME_DB.get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function kvPut(env: Env, key: string, value: string, ttl?: number): Promise<void> {
  await env.SNACKTIME_DB.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
}

/* ── Foods ─────────────────────────────────────────────────────────────── */

export function daysUntil(expDate: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expDate.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

export async function listFoods(env: Env, scope: Scope, sort: SortMode): Promise<FoodItem[]> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  if (sort === "expiry") {
    foods.sort((a, b) => a.expDate.localeCompare(b.expDate) || b.addedAt.localeCompare(a.addedAt));
  } else {
    foods.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return foods;
}

export async function addFood(env: Env, scope: Scope, name: string, expDate: string): Promise<FoodItem> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  const item: FoodItem = { id: crypto.randomUUID(), name: name.trim(), expDate, addedAt: new Date().toISOString() };
  foods.push(item);
  await kvPut(env, kFoods(scope), JSON.stringify(foods), scope.ttl);
  return item;
}

export async function deleteFood(env: Env, scope: Scope, id: string): Promise<FoodItem | null> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  const found = foods.find((f) => f.id === id) ?? null;
  const remaining = foods.filter((f) => f.id !== id);
  if (!found) return null;
  await kvPut(env, kFoods(scope), JSON.stringify(remaining), scope.ttl);
  return found;
}

export function expiringSoon(foods: FoodItem[]): FoodItem[] {
  return foods
    .filter((f) => daysUntil(f.expDate) <= 7)
    .sort((a, b) => a.expDate.localeCompare(b.expDate));
}

/* ── Ideas: validation (rejects malformed AI output) ──────────────────── */

function asMeasure(v: unknown): Measure | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const qty = Number(m.qty);
  if (!Number.isFinite(qty) || qty <= 0 || typeof m.unit !== "string") return null;
  return { qty, unit: m.unit.trim(), note: typeof m.note === "string" ? m.note.trim() : null };
}

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function validateIdea(raw: unknown, knownIds: Set<string>): RecipeIdea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const set = r.set === "pantry" ? "pantry" : r.set === "expiring" ? "expiring" : null;
  if (!set) return null;
  const scope = r.scope === "single" ? "single" : r.scope === "combined" ? "combined" : null;
  if (!scope) return null;
  const title = str(r.title, 160);
  if (!title) return null;

  const usesFoodIds = (Array.isArray(r.usesFoodIds) ? r.usesFoodIds : [])
    .filter((id): id is string => typeof id === "string" && knownIds.has(id));

  const ingredients: Ingredient[] = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .flatMap((rawIng) => {
      if (!rawIng || typeof rawIng !== "object") return [];
      const i = rawIng as Record<string, unknown>;
      const name = str(i.name, 120);
      if (!name) return [];
      const measures = (i.measures ?? {}) as Record<string, unknown>;
      const weight = asMeasure(measures.weight);
      const volume = asMeasure(measures.volume);
      if (!weight && !volume) return [];
      const tracked = typeof i.trackedFoodId === "string" && knownIds.has(i.trackedFoodId) ? i.trackedFoodId : null;
      return [{ name, trackedFoodId: tracked, optional: i.optional === true, measures: { weight, volume } }];
    });
  if (ingredients.length === 0) return null;

  const instructions = (Array.isArray(r.instructions) ? r.instructions : [])
    .map((s) => str(s, 800))
    .filter(Boolean);
  if (instructions.length === 0) return null;

  const times = (r.times ?? {}) as Record<string, unknown>;
  const servingsRaw = Math.round(Number(r.servings));

  return {
    set,
    scope,
    usesFoodIds,
    title,
    whyThisOne: str(r.whyThisOne, 300),
    servings: Number.isFinite(servingsRaw) ? Math.min(12, Math.max(1, servingsRaw)) : 4,
    times: {
      prepMinutes: Math.min(240, Math.max(0, Math.round(Number(times.prepMinutes)) || 10)),
      cookMinutes: Math.min(600, Math.max(0, Math.round(Number(times.cookMinutes)) || 20)),
    },
    ingredients,
    instructions,
    comments: str(r.comments, 400),
  };
}

function validateIdeas(raw: unknown, knownIds: Set<string>): { ideas: RecipeIdea[] } | { error: string } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).ideas)) {
    return { error: "response must be an object with an 'ideas' array" };
  }
  const ideas = (raw as Record<string, unknown[]>)["ideas"]
    .map((r) => validateIdea(r, knownIds))
    .filter((r): r is RecipeIdea => r !== null);
  if (ideas.length === 0) return { error: "no valid ideas found in response" };
  return { ideas };
}

/* ── AI: prompt + Gemini + mock ────────────────────────────────────────── */

export interface AiFood { id: string; name: string; expDate: string; daysLeft: number }

const MODEL = (env: Env) => env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          set: { type: "string", enum: ["expiring", "pantry"] },
          scope: { type: "string", enum: ["combined", "single"] },
          usesFoodIds: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          whyThisOne: { type: "string" },
          servings: { type: "integer" },
          times: { type: "object", properties: { prepMinutes: { type: "integer" }, cookMinutes: { type: "integer" } }, required: ["prepMinutes", "cookMinutes"] },
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
                    weight: { type: "object", nullable: true, properties: { qty: { type: "number" }, unit: { type: "string" } }, required: ["qty", "unit"] },
                    volume: { type: "object", nullable: true, properties: { qty: { type: "number" }, unit: { type: "string" }, note: { type: "string", nullable: true } }, required: ["qty", "unit"] },
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
        required: ["set", "scope", "usesFoodIds", "title", "whyThisOne", "servings", "times", "ingredients", "instructions", "comments"],
      },
    },
  },
  required: ["ideas"],
};

export function buildPrompt(expiring: AiFood[], pantryExtras: AiFood[], priorError?: string | null, avoidTitles?: string[]): string {
  const sectionA = expiring.length
    ? `SECTION A — every idea in this section must have "set": "expiring".
A1. Exactly 3 "combined" ideas — complete meals that use as MANY of the EXPIRING items together as possible (at least 2 expiring items each, ideally more). Varied cuisines and cooking methods.
A2. Exactly 2 "single" ideas for EACH expiring item (${expiring.map((f) => f.name).join(", ")}). Quick, realistic ideas where that food is the star; set usesFoodIds to just that one food's id.`
    : "";
  const sectionB = `SECTION B — every idea in this section must have "set": "pantry".
B1. Exactly 3 "combined" ideas — complete meals built around the WHOLE pantry (items ${expiring.length ? "that do AND that do not " : ""}expire soon; pick a different mix per meal). These must be DIFFERENT dishes from Section A${expiring.length ? " (do not repeat or rename Section A meals)" : ""}.
B2. Exactly 2 "single" ideas for EACH of these items: ${pantryExtras.length ? pantryExtras.map((f) => f.name).join(", ") : "(none)"}. Quick, realistic ideas where that food is the star; set usesFoodIds to just that one food's id.`;

  return `The user has food in their kitchen. Two lists (each item has an "id" you must reference):
EXPIRING within the next 7 days:
${JSON.stringify(expiring, null, 2)}
NOT expiring within 7 days (still in the pantry):
${JSON.stringify(pantryExtras, null, 2)}

Create recipe IDEAS as a JSON response with an "ideas" array. ${sectionA ? sectionA + "\n\n" : ""}${sectionB}
${avoidTitles && avoidTitles.length ? `
The user already saw and passed on these ideas — do NOT reuse or slightly-renamed-reuse ANY of them. Invent completely different dishes, techniques, and cuisines:
${avoidTitles.map((t) => `- ${t}`).join("\n")}
` : ""}
Rules:
- Every idea object needs ALL schema fields, including "set" ("expiring" for Section A, "pantry" for Section B).
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

async function generateWithGemini(env: Env, prompt: string): Promise<string> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL(env)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are a creative, practical home-cook assistant inside "SnackTime", an app that helps people eat their food before it goes bad. You always reply with ONLY a JSON object matching the required schema — no markdown, no commentary.' }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

/* ── Mock generator (deterministic, keyless dev) ───────────────────────── */

const COMBINED_TEMPLATES = [
  { title: (a: string, b: string) => `One-Pan ${a} & ${b} Skillet`, cuisine: "a cozy one-pan dinner" },
  { title: (a: string, b: string) => `${a} Stir-Fry over Rice`, cuisine: "a fast weeknight stir-fry" },
  { title: (a: string, b: string) => `Rustic ${a} Bowls with ${b}`, cuisine: "a build-your-own bowl" },
];
const SINGLE_TEMPLATES = [
  (name: string) => `${name} Fried Rice`,
  (name: string) => `Sheet-Pan ${name}`,
];

function measureFor(seed: number) {
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

function generateWithMock(expiring: AiFood[], pantryExtras: AiFood[]): string {
  const ideas: unknown[] = [];
  const combinedFor = (set: "expiring" | "pantry", foods: AiFood[]) => {
    const names = foods.map((f) => f.name);
    const a = names[0] ?? "veg";
    const b = names[1] ?? names[0] ?? "grain";
    COMBINED_TEMPLATES.forEach((t, i) => {
      const uses = foods.slice(0, Math.min(foods.length, i === 0 ? 3 : 2));
      ideas.push({
        set,
        scope: "combined",
        usesFoodIds: uses.map((f) => f.id),
        title: set === "pantry" ? `${t.title(a, b)} (pantry-style)` : t.title(a, b),
        whyThisOne: `Uses up ${uses.map((f) => f.name.toLowerCase()).join(" and ")} in ${t.cuisine}.`,
        servings: 4,
        times: { prepMinutes: 10 + i * 5, cookMinutes: 20 + i * 5 },
        ingredients: [
          ...uses.map((f, j) => ({ name: f.name, trackedFoodId: f.id, optional: false, measures: measureFor(i + j) })),
          { name: "cooked rice", trackedFoodId: null, optional: false, measures: { weight: { qty: 450, unit: "g" }, volume: { qty: 3, unit: "cups", note: "cooked" } } },
        ],
        instructions: mockInstructions(a, i === 1 ? "stir" : "pan"),
        comments: "Mock idea — set GEMINI_API_KEY as a Pages secret for real AI recipes.",
      });
    });
  };
  const singlesFor = (set: "expiring" | "pantry", foods: AiFood[]) => {
    for (const f of foods) {
      SINGLE_TEMPLATES.forEach((t, i) => {
        ideas.push({
          set,
          scope: "single",
          usesFoodIds: [f.id],
          title: set === "pantry" ? `${t(f.name)} (meal-prep twist)` : t(f.name),
          whyThisOne: `An easy way to use up your ${f.name.toLowerCase()}.`,
          servings: 2,
          times: { prepMinutes: 5 + i * 5, cookMinutes: 15 + i * 10 },
          ingredients: [
            { name: f.name, trackedFoodId: f.id, optional: false, measures: measureFor(i) },
            { name: "cooked rice", trackedFoodId: null, optional: false, measures: { weight: { qty: 300, unit: "g" }, volume: { qty: 2, unit: "cups", note: "cooked" } } },
            { name: "onion", trackedFoodId: null, optional: false, measures: { weight: { qty: 110, unit: "g" }, volume: { qty: 1, unit: "medium", note: "diced" } } },
            { name: "garlic", trackedFoodId: null, optional: true, measures: { weight: { qty: 6, unit: "g" }, volume: { qty: 2, unit: "cloves", note: null } } },
          ],
          instructions: mockInstructions(f.name, i === 0 ? "stir" : "pan"),
          comments: "Mock idea — set GEMINI_API_KEY as a Pages secret for real AI recipes.",
        });
      });
    }
  };
  if (expiring.length) {
    combinedFor("expiring", expiring);
    singlesFor("expiring", expiring);
  }
  combinedFor("pantry", [...expiring, ...pantryExtras]);
  singlesFor("pantry", pantryExtras);
  return JSON.stringify({ ideas });
}

/* ── Ideas orchestration (stateless: KV lock = single-flight) ─────────── */

export async function getIdeasView(env: Env, scope: Scope): Promise<IdeasView> {
  const [cache, lock, error] = await Promise.all([
    readJson<IdeasDoc | null>(env, kIdeas(scope), null),
    env.SNACKTIME_DB.get(kIdeasLock(scope)),
    env.SNACKTIME_DB.get(kIdeasError(scope)),
  ]);
  const generating = lock != null;
  const status: IdeasView["status"] = generating ? "generating" : cache && cache.ideas.length > 0 ? "ok" : "empty";
  return { status, generating, cache, error };
}

/**
 * Returns the current view and, if stale (new day / changed expiring list)
 * or forced, kicks off regeneration in the background (waitUntil).
 */
/* Ideas generation, client-driven:
   the browser asks /api/ideas/refresh, and when it says startGeneration it
   opens (fire-and-forget) /api/ideas/generate and keeps that request live.
   Generation then runs INSIDE a live request — no deferred server work that
   the runtime can silently freeze while Gemini hangs. */

const LOCK_FRESH_MS = 130_000; // a lock younger than this = a real generation is in flight

function lockIsFresh(raw: string | null): boolean {
  if (raw == null) return false;
  const t = Number(raw);
  return Number.isFinite(t) && Date.now() - t < LOCK_FRESH_MS;
}

function isFreshDoc(doc: IdeasDoc | null, allFoods: FoodItem[], soon: FoodItem[]): boolean {
  return (
    doc != null &&
    new Date(doc.generatedAt).toDateString() === new Date().toDateString() &&
    JSON.stringify(doc.foodSnapshot) === JSON.stringify(allFoods.map((f) => f.id).sort()) &&
    JSON.stringify(doc.expiringSnapshot) === JSON.stringify(soon.map((f) => f.id).sort())
  );
}

export async function refreshIdeasView(env: Env, scope: Scope, force = false): Promise<RefreshResult> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  const soon = expiringSoon(foods);
  const doc = await readJson<IdeasDoc | null>(env, kIdeas(scope), null);
  const view = await getIdeasView(env, scope);

  if (!force && isFreshDoc(doc, foods, soon)) return { view, startGeneration: false };
  if (lockIsFresh(await env.SNACKTIME_DB.get(kIdeasLock(scope)))) return { view, startGeneration: false };

  return { view: { ...view, status: "generating", generating: true }, startGeneration: true };
}

/** Synchronous generation — the caller's open request keeps this alive. */
export async function generateIdeasNow(env: Env, scope: Scope, force: boolean): Promise<IdeasView> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  const soon = expiringSoon(foods);
  const doc = await readJson<IdeasDoc | null>(env, kIdeas(scope), null);

  if (!force && isFreshDoc(doc, foods, soon)) return getIdeasView(env, scope);
  if (lockIsFresh(await env.SNACKTIME_DB.get(kIdeasLock(scope)))) return getIdeasView(env, scope);

  await env.SNACKTIME_DB.put(kIdeasLock(scope), String(Date.now()), { expirationTtl: 180 });
  const avoid = force && doc ? doc.ideas.map((i) => i.title) : [];
  await generateAndSave(env, scope, foods, soon, avoid);
  return getIdeasView(env, scope);
}

async function generateAndSave(env: Env, scope: Scope, allFoods: FoodItem[], soon: FoodItem[], avoidTitles: string[]): Promise<void> {
  try {
    await env.SNACKTIME_DB.delete(kIdeasError(scope));
    if (allFoods.length === 0) {
      await kvPut(env, kIdeas(scope), JSON.stringify({ generatedAt: new Date().toISOString(), generator: "none", foodSnapshot: [], expiringSnapshot: [], ideas: [] }), scope.ttl);
      return;
    }
    const toAi = (f: FoodItem): AiFood => ({ id: f.id, name: f.name, expDate: f.expDate, daysLeft: daysUntil(f.expDate) });
    const soonIds = new Set(soon.map((f) => f.id));
    const expiringAi = soon.map(toAi);
    // solo ideas for non-expiring foods: closest to expiry first, capped to keep the batch reasonable
    const extrasAi = allFoods
      .filter((f) => !soonIds.has(f.id))
      .sort((a, b) => a.expDate.localeCompare(b.expDate))
      .slice(0, 8)
      .map(toAi);
    const knownIds = new Set(allFoods.map((f) => f.id));

    let attemptError: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let text: string;
      let generator: string;
      try {
        if (env.GEMINI_API_KEY?.trim()) {
          text = await generateWithGemini(env, buildPrompt(expiringAi, extrasAi, attemptError, avoidTitles));
          generator = `gemini:${MODEL(env)}`;
        } else {
          text = generateWithMock(expiringAi, extrasAi);
          generator = "mock";
        }
      } catch (e) {
        attemptError = (e as Error).message;
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        attemptError = "response was not valid JSON — return ONLY the JSON object";
        continue;
      }
      const result = validateIdeas(parsed, knownIds);
      if ("error" in result) {
        attemptError = result.error;
        continue;
      }
      const doc: IdeasDoc = {
        generatedAt: new Date().toISOString(),
        generator,
        foodSnapshot: allFoods.map((f) => f.id).sort(),
        expiringSnapshot: soon.map((f) => f.id).sort(),
        ideas: result.ideas,
      };
      await kvPut(env, kIdeas(scope), JSON.stringify(doc), scope.ttl);
      return;
    }
    await kvPut(env, kIdeasError(scope), `AI ideas failed after 2 attempts: ${attemptError ?? "unknown error"}`, scope.ttl);
  } finally {
    await env.SNACKTIME_DB.delete(kIdeasLock(scope));
  }
}

/* ── Weekly email (dev stub → outbox in KV; wire real email in T12) ───── */

export async function sendWeeklyDigest(env: Env, scope: Scope): Promise<{ count: number; digest: string }> {
  const foods = await readJson<FoodItem[]>(env, kFoods(scope), []);
  const soon = foods.filter((f) => daysUntil(f.expDate) <= 7).sort((a, b) => a.expDate.localeCompare(b.expDate));
  const lines = [
    "Subject: SnackTime — food expiring in the next week",
    `Date: ${new Date().toString()}`,
    "(dev stub: wire a real email provider in T12)",
    "".padEnd(52, "="),
    "",
  ];
  if (soon.length === 0) lines.push("Nothing expires in the next 7 days. Nice work!");
  for (const f of soon) {
    const d = daysUntil(f.expDate);
    const label = d < 0 ? `ALREADY EXPIRED (${-d}d ago)` : d === 0 ? "EXPIRES TODAY" : `expires in ${d} day${d === 1 ? "" : "s"}`;
    lines.push(`  • ${f.name} — ${f.expDate} (${label})`);
  }
  lines.push("", "— The SnackTime", "");
  const digest = lines.join("\n");
  await kvPut(env, kOutbox(scope), digest, scope.ttl);
  return { count: soon.length, digest };
}
