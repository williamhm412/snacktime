import { useState } from "react";
import ListScreen from "./screens/ListScreen";
import AddScreen from "./screens/AddScreen";
import IdeasScreen from "./screens/IdeasScreen";

export type Tab = "list" | "add" | "ideas";

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: "add",
    label: "Add",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
    ),
  },
  {
    id: "ideas",
    label: "Ideas",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1 1 1.8l.1.8h4.8l.1-.8c.1-.7.4-1.3 1-1.8A6 6 0 0 0 12 3Z" />
        <path d="M10 19.5h4M10.5 21.5h3" />
      </svg>
    ),
  },
  {
    id: "list",
    label: "List",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 6.5h16M4 12h16M4 17.5h10" />
      </svg>
    ),
  },
];

const TITLES: Record<Tab, string> = {
  list: "My Food",
  add: "Add Food",
  ideas: "Ideas",
};

export default function App() {
  const [tab, setTab] = useState<Tab>("list");
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-dot" /> SnackTime
        </span>
        <h1 className="page-title">{TITLES[tab]}</h1>
      </header>

      <main className="content">
        {/* keyed remount per tab keeps each screen's fetch-on-mount simple */}
        {tab === "list" && <ListScreen key="list" />}
        {tab === "add" && <AddScreen key="add" onAdded={() => setTab("list")} />}
        {tab === "ideas" && <IdeasScreen key="ideas" />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
            aria-label={t.label}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
