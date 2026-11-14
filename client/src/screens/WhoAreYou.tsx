import { useMemo, useState } from "react";
import { PEOPLE, saveChoice, type UserChoice } from "../user";

/* Shown on first open (and whenever the person switches profiles).
   A search box filters the option list — type "m" and you get Ammon/McKay… */

function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
}

export default function WhoAreYou({ onPicked }: { onPicked: (choice: UserChoice) => void }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? PEOPLE.filter((p) => p.name.toLowerCase().includes(q)) : PEOPLE;
    return list;
  }, [query]);

  function pick(id: UserChoice) {
    saveChoice(id);
    onPicked(id);
  }

  return (
    <div className="who-screen">
      <div className="who-card">
        <span className="brand-dot who-logo" />
        <h2 className="who-title">Who are you?</h2>
        <p className="who-sub">SnackTime keeps a separate pantry for each person.</p>

        <input
          className="who-search"
          type="text"
          inputMode="search"
          placeholder="Search or tap a name…"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="who-list">
          {visible.map((p) => (
            <li key={p.id}>
              <button className="who-option" onClick={() => pick(p.id)}>
                <span className={`who-avatar ${p.id === "guest" ? "who-avatar-guest" : ""}`}>
                  {p.id === "guest" ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="12" cy="8.5" r="3.5" />
                      <path d="M5 20c1.2-3.2 4-4.8 7-4.8s5.8 1.6 7 4.8" />
                    </svg>
                  ) : (
                    initials(p.name)
                  )}
                </span>
                <span className="who-option-text">
                  <span className="who-option-name">{p.name}</span>
                  {p.note && <span className="who-option-note">{p.note}</span>}
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="who-empty">No one named “{query.trim()}” — try another spelling?</li>}
        </ul>
      </div>
    </div>
  );
}
