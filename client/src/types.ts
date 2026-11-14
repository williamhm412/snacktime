export interface FoodItem {
  id: string;
  name: string;
  /** expiration date, YYYY-MM-DD */
  expDate: string;
  /** when the item was added, ISO timestamp */
  addedAt: string;
}

export type SortMode = "added" | "expiry";
