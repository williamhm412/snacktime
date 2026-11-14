import { useCallback, useEffect, useState } from "react";
import { deleteFood, fetchFoods, refreshIdeas } from "../api";
import { expiryBadge, formatExpDate, addedAgo } from "../dates";
import type { FoodItem, SortMode } from "../types";

export default function ListScreen() {
  const [foods, setFoods] = useState<FoodItem[] | null>(null);
  const [sort, setSort] = useState<SortMode>("expiry");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchFoods(sort)
      .then(setFoods)
      .catch((e: Error) => setError(e.message));
  }, [sort]);

  useEffect(() => {
    setFoods(null);
    load();
  }, [load]);

  async function handleUsed(id: string) {
    // optimistic remove for a snappy feel
    setFoods((prev) => prev?.filter((f) => f.id !== id) ?? prev);
    try {
      await deleteFood(id);
      refreshIdeas(false).catch(() => {}); // background: keep ideas in sync
    } catch (e) {
      setError((e as Error).message);
      load(); // roll back
    }
  }

  return (
    <section>
      <div className="segmented" role="tablist" aria-label="Sort order">
        <button
          className={sort === "expiry" ? "segmented-on" : ""}
          onClick={() => setSort("expiry")}
        >
          Expiring soon
        </button>
        <button
          className={sort === "added" ? "segmented-on" : ""}
          onClick={() => setSort("added")}
        >
          Recently added
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {foods === null ? (
        !error && <div className="empty">Loading…</div>
      ) : foods.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🥕</div>
          <p className="empty-title">Nothing on the shelves</p>
          <p>Tap “Add” to log your first food.</p>
        </div>
      ) : (
        <ul className="card-list">
          {foods.map((f) => {
            const badge = expiryBadge(f.expDate);
            return (
              <li className="food-card" key={f.id}>
                <div className="food-info">
                  <span className="food-name">{f.name}</span>
                  <span className="food-date">Expires {formatExpDate(f.expDate)}</span>
                  {sort === "added" && (
                    <span className="food-added">added {addedAgo(f.addedAt)}</span>
                  )}
                </div>
                <div className="food-actions">
                  <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
                  <button
                    className="used-btn"
                    onClick={() => handleUsed(f.id)}
                    title="Mark as used"
                    aria-label={`Mark ${f.name} as used`}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
