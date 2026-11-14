export interface FoodItem {
  /** unique id (uuid) */
  id: string;
  /** food name as typed by the user */
  name: string;
  /** expiration date, YYYY-MM-DD */
  expDate: string;
  /** when the item was added, ISO timestamp */
  addedAt: string;
}

export type SortMode = "added" | "expiry";
