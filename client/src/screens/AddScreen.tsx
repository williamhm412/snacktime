import { FormEvent, useState } from "react";
import { addFood } from "../api";
import { localISODate } from "../dates";

export default function AddScreen({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [expDate, setExpDate] = useState(localISODate(3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !expDate || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addFood(name.trim(), expDate);
      onAdded(); // bounce back to the list, like Venmo's "done" flow
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <section className="add-screen">
      <form className="add-card" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="food-name">
          Food
        </label>
        <input
          id="food-name"
          className="field"
          type="text"
          placeholder="e.g. Strawberries"
          value={name}
          maxLength={200}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />

        <label className="field-label" htmlFor="food-exp">
          Expiration date
        </label>
        <input
          id="food-exp"
          className="field"
          type="date"
          value={expDate}
          onChange={(e) => setExpDate(e.target.value)}
        />

        {error && <div className="notice notice-error">{error}</div>}

        <button className="primary-btn" type="submit" disabled={!name.trim() || saving}>
          {saving ? "Adding…" : "Add food"}
        </button>
      </form>
      <p className="hint">Tip: log food the day you buy it and the app will keep the countdown.</p>
    </section>
  );
}
