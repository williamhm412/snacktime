import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadFoods } from "./store.js";
import { daysUntil } from "./email.js";
import { generateWithGemini, generateWithMock, buildPrompt, MODEL, type AiFood } from "./ai.js";
import type { FoodItem } from "./types.js";

/* ── Recipe format (what the AI must return) ──────────────────────────── */

export interface Measure {
  qty: number;
  unit: string;
  note?: string | null;
}

export interface Ingredient {
  name: string;
  /** id of the tracked food this uses (null = pantry staple) */
  trackedFoodId: string | null;
  optional: boolean;
  measures: { weight: Measure | null; volume: Measure | null };
}

export interface RecipeIdea {
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
  /** ISO timestamp of when this set was generated */
  generatedAt: string;
  /** which generator produced it, e.g. "gemini:gemini-2.0-flash" or "mock" */
  generator: string;
  /** sorted ids of expiring-soon foods at generation time (staleness check) */
  foodSnapshot: string[];
  ideas: RecipeIdea[];
}

export interface IdeasView {
  status: "ok" | "generating" | "empty";
  generating: boolean;
  cache: IdeasDoc | null;
  error: string | null;
}

const IDEAS_FILE = join(DATA_DIR, "ideas.json");
const WINDOW_DAYS = 7;
const MAX_SINGLE_FOODS = 8; // per-food ideas only for the soonest-expiring N items

/* ── Cache I/O ────────────────────────────────────────────────────────── */

function loadIdeas(): IdeasDoc | null {
  try {
    if (!existsSync(IDEAS_FILE)) return null;
    return JSON.parse(readFileSync(IDEAS_FILE, "utf8")) as IdeasDoc;
  } catch {
    return null;
  }
}

function saveIdeas(doc: IdeasDoc): void {
  const tmp = IDEAS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  renameSync(tmp, IDEAS_FILE);
}

/* ── Freshness ────────────────────────────────────────────────────────── */

export function expiringSoon(): FoodItem[] {
  return loadFoods()
    .filter((f) => daysUntil(f.expDate) <= WINDOW_DAYS)
    .sort((a, b) => a.expDate.localeCompare(b.expDate));
}

function sameLocalDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isFresh(doc: IdeasDoc | null, soon: FoodItem[]): boolean {
  if (!doc) return false;
  const snapshot = soon.map((f) => f.id).sort();
  return (
    sameLocalDay(doc.generatedAt) &&
    JSON.stringify(doc.foodSnapshot) === JSON.stringify(snapshot)
  );
}

/* ── Response validation (repair + reject) ───────────────────────────── */

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

/** Validate/repair one idea. Returns null if unusable. */
function validateIdea(raw: unknown, knownIds: Set<string>): RecipeIdea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const scope = r.scope === "single" ? "single" : r.scope === "combined" ? "combined" : null;
  if (!scope) return null;
  const title = str(r.title, 160);
  if (!title) return null;

  const usesFoodIds = (Array.isArray(r.usesFoodIds) ? r.usesFoodIds : [])
    .filter((id): id is string => typeof id === "string" && knownIds.has(id));

  const ingredients: Ingredient[] = (
    Array.isArray(r.ingredients) ? r.ingredients : []
  ).flatMap((rawIng) => {
    if (!rawIng || typeof rawIng !== "object") return [];
    const i = rawIng as Record<string, unknown>;
    const name = str(i.name, 120);
    if (!name) return [];
    const measures = (i.measures ?? {}) as Record<string, unknown>;
    const weight = asMeasure(measures.weight);
    const volume = asMeasure(measures.volume);
    if (!weight && !volume) return [];
    const tracked = typeof i.trackedFoodId === "string" && knownIds.has(i.trackedFoodId)
      ? i.trackedFoodId
      : null;
    return [{
      name,
      trackedFoodId: tracked,
      optional: i.optional === true,
      measures: { weight, volume },
    }];
  });
  if (ingredients.length === 0) return null;

  const instructions = (Array.isArray(r.instructions) ? r.instructions : [])
    .map((s) => str(s, 800))
    .filter(Boolean);
  if (instructions.length === 0) return null;

  const times = (r.times ?? {}) as Record<string, unknown>;
  const servingsRaw = Math.round(Number(r.servings));

  return {
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

function validateIdeas(raw: unknown, knownIds: Set<string>):
  { ideas: RecipeIdea[] } | { error: string } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).ideas)) {
    return { error: "response must be an object with an 'ideas' array" };
  }
  const ideas = (raw as Record<string, unknown[]>)["ideas"]
    .map((r) => validateIdea(r, knownIds))
    .filter((r): r is RecipeIdea => r !== null);
  if (ideas.length === 0) return { error: "no valid ideas found in response" };
  return { ideas };
}

/* ── Generation orchestration (debounced + single-flight) ─────────────── */

let inflight: Promise<void> | null = null;
let rerunRequested = false;
let lastAvoid: string[] = [];
let generating = false;
let lastError: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function doGenerate(reason: string, avoidTitles: string[] = []): Promise<void> {
  generating = true;
  lastError = null;
  const soon = expiringSoon();
  console.log(`[ideas] generating (${reason}) — ${soon.length} item(s) in window`);
  try {
    if (soon.length === 0) {
      const doc: IdeasDoc = { generatedAt: new Date().toISOString(), generator: "none", foodSnapshot: [], ideas: [] };
      saveIdeas(doc);
      console.log("[ideas] pantry window empty — cleared cached ideas");
    } else {
      const singleFoods = soon.slice(0, MAX_SINGLE_FOODS);
      const knownIds = new Set(soon.map((f) => f.id));
      const aiFoods: AiFood[] = soon.map((f) => ({
        id: f.id,
        name: f.name,
        expDate: f.expDate,
        daysLeft: daysUntil(f.expDate),
      }));
      const singleIds = new Set(singleFoods.map((f) => f.id));

      let attemptError: string | null = null;
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        let text: string, generator: string;
        try {
          ({ text, generator } = await generateWithAI(
            buildPrompt(aiFoods, singleIds, attemptError ?? null, avoidTitles)
          ));
        } catch (e) {
          attemptError = (e as Error).message;
          console.warn(`[ideas] attempt ${attempt} failed: ${attemptError}`);
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
          foodSnapshot: soon.map((f) => f.id).sort(),
          ideas: result.ideas,
        };
        saveIdeas(doc);
        console.log(`[ideas] saved ${doc.ideas.length} idea(s) via ${doc.generator}`);
        done = true;
      }
      if (!done) {
        lastError = `AI ideas failed after 2 attempts: ${attemptError ?? "unknown error"}`;
        console.error(`[ideas] ${lastError}`);
      }
    }
  } catch (e) {
    lastError = (e as Error).message;
    console.error(`[ideas] generation failed: ${lastError}`);
  } finally {
    generating = false;
    inflight = null;
    lastAvoid = []; // "don't repeat" applies to the manual refresh, not future auto-updates
  }
}

function runGeneration(reason: string, avoid: string[] = []): Promise<void> {
  lastAvoid = avoid.length > 0 ? avoid : lastAvoid;
  if (inflight) {
    // changes during generation must not be lost — re-run once it finishes
    rerunRequested = true;
    return inflight;
  }
  inflight = doGenerate(reason, lastAvoid).then(() => {
    if (rerunRequested) {
      rerunRequested = false;
      return runGeneration("list changed during generation");
    }
  });
  return inflight;
}

/** Fire-and-forget trigger with a short debounce (batches rapid changes). */
export function requestGeneration(reason: string, delayMs = 1500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runGeneration(reason);
  }, delayMs);
}

/** Regenerate if stale (new day, changed expiring list) or forced. */
export async function ensureFreshIdeas(force = false): Promise<void> {
  const doc = loadIdeas();
  const soon = expiringSoon();
  if (!force && isFresh(doc, soon)) return;
  if (inflight) return; // one at a time; caller sees status=generating
  // a manual refresh means the user didn't like these — tell the AI to avoid them
  const avoid = force && doc ? doc.ideas.map((i) => i.title) : [];
  await runGeneration(force ? "manual refresh" : "stale (daily/list change)", avoid);
}

export function getIdeasView(): IdeasView {
  const cache = loadIdeas();
  const status: IdeasView["status"] = generating
    ? "generating"
    : cache && cache.ideas.length > 0
      ? "ok"
      : "empty";
  return { status, generating, cache, error: lastError };
}

/** Pick provider: Gemini when a key exists, mock otherwise. */
async function generateWithAI(prompt: string): Promise<{ text: string; generator: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) {
    return { text: await generateWithGemini(prompt), generator: `gemini:${MODEL()}` };
  }
  return { text: generateWithMock(expiringSoon().map((f) => ({ id: f.id, name: f.name, expDate: f.expDate, daysLeft: daysUntil(f.expDate) }))), generator: "mock" };
}
