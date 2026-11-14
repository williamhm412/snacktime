import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FoodItem, SortMode } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** All app data lives in server/data/ — plain files you can open anytime. */
export const DATA_DIR = join(__dirname, "..", "data");
const FOODS_FILE = join(DATA_DIR, "foods.json");
export const OUTBOX_DIR = join(DATA_DIR, "outbox");

function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUTBOX_DIR, { recursive: true });
}

/** Read the full food list from disk. */
export function loadFoods(): FoodItem[] {
  ensureDirs();
  if (!existsSync(FOODS_FILE)) return [];
  try {
    const raw = readFileSync(FOODS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FoodItem[]) : [];
  } catch {
    console.error("[store] foods.json unreadable, starting empty");
    return [];
  }
}

/** Write the full food list to disk (atomic-ish: write to temp then rename). */
function saveFoods(foods: FoodItem[]): void {
  ensureDirs();
  const tmp = FOODS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(foods, null, 2) + "\n", "utf8");
  renameSync(tmp, FOODS_FILE);
}

export function listFoods(sort: SortMode = "added"): FoodItem[] {
  const foods = loadFoods();
  if (sort === "expiry") {
    foods.sort(
      (a, b) => a.expDate.localeCompare(b.expDate) || b.addedAt.localeCompare(a.addedAt)
    );
  } else {
    foods.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return foods;
}

export function addFood(name: string, expDate: string): FoodItem {
  const item: FoodItem = {
    id: randomUUID(),
    name: name.trim(),
    expDate,
    addedAt: new Date().toISOString(),
  };
  const foods = loadFoods();
  foods.push(item);
  saveFoods(foods);
  return item;
}

/** Look up one item by id (before deleting, etc.). */
export function getFood(id: string): FoodItem | undefined {
  return loadFoods().find((f) => f.id === id);
}

/** Returns true if an item was found and removed. */
export function deleteFood(id: string): boolean {
  const foods = loadFoods();
  const remaining = foods.filter((f) => f.id !== id);
  if (remaining.length === foods.length) return false;
  saveFoods(remaining);
  return true;
}
