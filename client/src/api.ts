import type { FoodItem, SortMode } from "./types";
import type { IdeasView } from "./recipeTypes";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export function fetchFoods(sort: SortMode): Promise<FoodItem[]> {
  return fetch(`/api/foods?sort=${sort}`).then((r) => handle<FoodItem[]>(r));
}

export function addFood(name: string, expDate: string): Promise<FoodItem> {
  return fetch("/api/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, expDate }),
  }).then((r) => handle<FoodItem>(r));
}

export function deleteFood(id: string): Promise<void> {
  return fetch(`/api/foods/${id}`, { method: "DELETE" }).then((r) => handle<void>(r));
}

export function sendDigestNow(): Promise<{ file: string; count: number }> {
  return fetch("/api/email/send-now", { method: "POST" }).then((r) =>
    handle<{ file: string; count: number }>(r)
  );
}

export function getIdeas(): Promise<IdeasView> {
  return fetch("/api/ideas").then((r) => handle<IdeasView>(r));
}

export function refreshIdeas(force = false): Promise<IdeasView> {
  return fetch("/api/ideas/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  }).then((r) => handle<IdeasView>(r));
}
