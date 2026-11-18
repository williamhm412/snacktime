import { useEffect, useRef, useState } from "react";
import ListScreen from "./screens/ListScreen";
import AddScreen from "./screens/AddScreen";
import IdeasScreen from "./screens/IdeasScreen";
import WhoAreYou from "./screens/WhoAreYou";
import { refreshIdeas } from "./api";
import { clearChoice, displayName, loadStoredChoice, type UserChoice } from "./user";

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

function UserChip({ user, onSwitch }: { user: UserChoice; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // click anywhere outside the popover closes it
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="user-chip-wrap" ref={wrapRef}>
      <button className="user-chip" onClick={() => setOpen((o) => !o)} aria-label="Your profile">
        <span className="user-chip-dot" />
        {displayName(user)}
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="user-popover">
          <p className="user-popover-hint">
            {user === "guest"
              ? "Guest session — everything is erased when you close this page."
              : `${displayName(user)}'s pantry is saved in the cloud on every device.`}
          </p>
          <button className="user-popover-switch" onClick={onSwitch}>
            Switch person
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("list");
  const [user, setUser] = useState<UserChoice | null>(() => loadStoredChoice());

  // Once-a-day AI refresh: the first app open each day (any tab) asks the
  // backend for a fresh batch; the server considers today's batch fresh after
  // that, so the rest of the day's opens are free. Mid-day = ↻ button only.
  useEffect(() => {
    if (!user) return;
    refreshIdeas(false).catch(() => {});
  }, [user]);

  if (!user) {
    return (
      <div className="app">
        <WhoAreYou onPicked={setUser} />
      </div>
    );
  }

  function switchPerson() {
    clearChoice();
    setUser(null); // back to the "Who are you?" screen
    setTab("list");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <span className="brand">
            <span className="brand-dot" /> SnackTime
          </span>
          <UserChip user={user} onSwitch={switchPerson} />
        </div>
        <h1 className="page-title">{TITLES[tab]}</h1>
      </header>

      <main className="content">
        {/* keyed remount per tab keeps each screen's fetch-on-mount simple;
            the user part of the key reloads everything when the person changes */}
        {tab === "list" && <ListScreen key={`list:${user}`} />}
        {tab === "add" && <AddScreen key={`add:${user}`} onAdded={() => setTab("list")} />}
        {tab === "ideas" && <IdeasScreen key={`ideas:${user}`} />}
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
