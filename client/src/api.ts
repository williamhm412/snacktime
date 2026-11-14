import type { FoodItem, SortMode } from "./types";
import type { IdeasView } from "./recipeTypes";
import { loadStoredChoice, userHeaderValue } from "./user";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** All API calls carry the chosen person so the cloud keeps pantries separate. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const choice = loadStoredChoice();
  if (choice) headers.set("X-Snacktime-User", userHeaderValue(choice));
  return fetch(path, { ...init, headers }).then((r) => handle<T>(r));
}

export function fetchFoods(sort: SortMode): Promise<FoodItem[]> {
  return api<FoodItem[]>(`/api/foods?sort=${sort}`);
}

export function addFood(name: string, expDate: string): Promise<FoodItem> {
  return api<FoodItem>("/api/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, expDate }),
  });
}

export function deleteFood(id: string): Promise<void> {
  return api<void>(`/api/foods/${id}`, { method: "DELETE" });
}

export function sendDigestNow(): Promise<{ file: string; count: number }> {
  return api<{ file: string; count: number }>("/api/email/send-now", { method: "POST" });
}

export function getIdeas(): Promise<IdeasView> {
  return api<IdeasView>("/api/ideas");
}

interface RefreshResponse {
  view: IdeasView;
  startGeneration: boolean;
}

/** Fire-and-forget: the OPEN request itself drives the AI while it runs. */
function fireGenerate(force: boolean): void {
  api<IdeasView>("/api/ideas/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  }).catch(() => {}); // result arrives via the poller; errors here are non-fatal
}

export async function refreshIdeas(force = false): Promise<IdeasView> {
  const r = await api<RefreshResponse>("/api/ideas/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (r.startGeneration) fireGenerate(force);
  return r.view;
}
