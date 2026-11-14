import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFoods, refreshIdeas } from "../api";
import { daysUntil, formatExpDate } from "../dates";
import type { FoodItem } from "../types";
import type { IdeasView, Ingredient, RecipeIdea } from "../recipeTypes";

type Unit = "volume" | "weight";
type Mode = "expiring" | "all" | "byfood";

/* ── small helpers ─────────────────────────────────────────────────────── */

function measureText(ing: Ingredient, unit: Unit): string {
  const m =
    unit === "volume"
      ? ing.measures.volume ?? ing.measures.weight
      : ing.measures.weight ?? ing.measures.volume;
  if (!m) return "";
  const qty = Number.isInteger(m.qty) ? String(m.qty) : String(m.qty).replace(/\.5$/, "½");
  return `${qty} ${m.unit}`.trim();
}

function updatedWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `Updated ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : `Updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/* ── summary card (tap → full-screen recipe) ───────────────────────────── */

function IdeaCard({
  idea,
  onOpen,
  foodName,
}: {
  idea: RecipeIdea;
  onOpen: () => void;
  foodName: (id: string) => string | undefined;
}) {
  const usedNames = idea.usesFoodIds
    .map(foodName)
    .filter((n): n is string => !!n)
    .slice(0, 3);
  return (
    <li className="idea-card idea-tappable" onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="food-info">
        <span className="food-name">{idea.title}</span>
        <span className="idea-why">{idea.whyThisOne}</span>
        {usedNames.length > 0 && (
          <span className="idea-uses">
            {usedNames.map((n) => (
              <span className="chip" key={n}>{n}</span>
            ))}
          </span>
        )}
      </div>
      <span className="chevron" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </li>
  );
}

/* ── full-screen recipe view (unit toggle top-right, back top-left) ────── */

function RecipeFull({
  idea,
  unit,
  setUnit,
  onBack,
  foodName,
}: {
  idea: RecipeIdea;
  unit: Unit;
  setUnit: (u: Unit) => void;
  onBack: () => void;
  foodName: (id: string) => string | undefined;
}) {
  const total = idea.times.prepMinutes + idea.times.cookMinutes;
  return (
    <div className="recipe-full">
      <header className="rf-head">
        <button className="rf-back" onClick={onBack} aria-label="Back to ideas">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back
        </button>
        <div className="unit-toggle" role="group" aria-label="Measurement units">
          <button className={unit === "volume" ? "unit-on" : ""} onClick={() => setUnit("volume")}>cups / tsp</button>
          <button className={unit === "weight" ? "unit-on" : ""} onClick={() => setUnit("weight")}>g / ml</button>
        </div>
      </header>

      <div className="rf-body">
        <h2 className="rf-title">{idea.title}</h2>
        {idea.whyThisOne && <p className="rf-why">{idea.whyThisOne}</p>}

        <div className="recipe-meta">
          <span>⏱ {total} min <em>(prep {idea.times.prepMinutes} · cook {idea.times.cookMinutes})</em></span>
          <span>🍽 Serves {idea.servings}</span>
        </div>

        <h3 className="rf-section">Ingredients</h3>
        <ul className="ing-list">
          {idea.ingredients.map((ing, i) => (
            <li key={i}>
              <span className="ing-qty">{measureText(ing, unit)}</span>{" "}
              <span className="ing-name">
                {ing.name}
                {(unit === "volume" ? ing.measures.volume?.note : ing.measures.weight?.note) ? `, ${ing.measures.volume?.note ?? ing.measures.weight?.note}` : ""}
                {ing.optional ? " (optional)" : ""}
              </span>{" "}
              {ing.trackedFoodId && foodName(ing.trackedFoodId) && (
                <span className="chip chip-mine">your {foodName(ing.trackedFoodId)?.toLowerCase()}</span>
              )}
            </li>
          ))}
        </ul>

        <h3 className="rf-section">Instructions</h3>
        <ol className="step-list">
          {idea.instructions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>

        {idea.comments && <p className="recipe-comment">💡 {idea.comments}</p>}
      </div>
    </div>
  );
}

/* ── info sheet (the ⓘ explainer) ──────────────────────────────────────── */

function InfoSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How Ideas works">
        <div className="sheet-handle" />
        <h2>How Ideas works</h2>
        <ul>
          <li><b>Three views of your food.</b> <b>“Expiring”</b> (default) plans meals around food within 7 days of expiring. <b>“Use It All”</b> plans meals around your WHOLE pantry, whatever the dates. <b>“Ideas by Food”</b> gives every food 2 quick solo ideas, regardless of expiry.</li>
          <li><b>Ideas refresh automatically</b> the first time you open this tab each day and whenever your list changes — like when you add food or mark something used. So recipes always match what's actually in your kitchen.</li>
          <li><b>Tap ↻</b> for a brand-new batch — the AI is told the current ideas and won't repeat any of them.</li>
          <li><b>Pantry staples are assumed</b> — oil, salt, spices, rice, pasta, onions, garlic and the like. The ingredient list shows what you'd still need to buy.</li>
          <li><b>Units toggle:</b> flip between volume (cups/tsp) and weight (g/ml) inside any open recipe. Estimates are approximate — cook with your eyes and nose.</li>
          <li><b>These are AI suggestions</b>, not nutrition or food-safety advice. When in doubt on freshness, trust your senses.</li>
        </ul>
        <button className="primary-btn sheet-close" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

/* ── main screen ───────────────────────────────────────────────────────── */

export default function IdeasScreen() {
  const [view, setView] = useState<IdeasView | null>(null);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [mode, setMode] = useState<Mode>("expiring");
  const [openIdea, setOpenIdea] = useState<RecipeIdea | null>(null);
  const [openFoods, setOpenFoods] = useState<Set<string>>(new Set());
  const [unit, setUnit] = useState<Unit>("volume");
  const [showInfo, setShowInfo] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyView = useCallback((v: IdeasView) => setView(v), []);

  // initial load: fetch expiring foods + ask server to ensure fresh ideas
  useEffect(() => {
    let live = true;
    fetchFoods("expiry").then((f) => live && setFoods(f)).catch(() => {});
    refreshIdeas(false)
      .then((v) => live && applyView(v))
      .catch(() => live && setView({ status: "empty", generating: false, cache: null, error: "Couldn't reach the server. Is the backend running?" }));
    return () => { live = false; };
  }, [applyView]);

  // poll while the AI is working (via refresh so a dropped generation auto-restarts)
  useEffect(() => {
    if (!view?.generating) return;
    pollRef.current = setInterval(() => {
      refreshIdeas(false).then(applyView).catch(() => {});
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [view?.generating, applyView]);

  async function manualRefresh() {
    setView((v) => (v ? { ...v, generating: true, status: "generating" } : v));
    try {
      applyView(await refreshIdeas(true));
    } catch {
      applyView({ status: "empty", generating: false, cache: view?.cache ?? null, error: "Refresh failed — is the backend running?" });
    }
  }

  function toggleFood(id: string) {
    setOpenFoods((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const foodById = new Map(foods.map((f) => [f.id, f]));
  const foodName = (id: string) => foodById.get(id)?.name;

  const cache = view?.cache ?? null;
  const generating = view?.generating ?? false;
  const ideas = cache?.ideas ?? [];
  // tolerate older cached docs that predate the "set" field
  const setOf = (i: RecipeIdea) => i.set ?? "expiring";
  const combinedExpiring = ideas.filter((i) => i.scope === "combined" && setOf(i) === "expiring");
  const combinedPantry = ideas.filter((i) => i.scope === "combined" && setOf(i) === "pantry");
  const singles = ideas.filter((i) => i.scope === "single");

  // group singles per tracked food (both sets), only for foods still on the list
  const perFood = new Map<string, RecipeIdea[]>();
  for (const idea of singles) {
    const id = idea.usesFoodIds[0];
    if (!id || !foodById.has(id)) continue; // food was used/removed — hide its ideas
    perFood.set(id, [...(perFood.get(id) ?? []), idea]);
  }
  const perFoodEntries = [...perFood.entries()].sort((a, b) =>
    foodById.get(a[0])!.expDate.localeCompare(foodById.get(b[0])!.expDate)
  );

  const isMock = cache?.generator === "mock";
  const pantryEmpty = foods.length === 0;
  const expiringCount = foods.filter((f) => daysUntil(f.expDate) <= 7).length;
  const modeIdeas =
    mode === "expiring" ? combinedExpiring : mode === "all" ? combinedPantry : singles;
  const modeEmpty =
    mode === "byfood" ? perFoodEntries.length === 0 : modeIdeas.length === 0;

  return (
    <section>
      {/* toolbar: info + refresh */}
      <div className="ideas-toolbar">
        <span className="ideas-updated">
          {cache && cache.ideas.length > 0 && !generating && updatedWhen(cache.generatedAt)}
          {generating && <span className="generating-pill">✨ Fresh ideas incoming…</span>}
        </span>
        <span className="ideas-tools">
          <button className="icon-btn" onClick={manualRefresh} title="New batch — AI won't repeat current ideas" aria-label="Get new ideas">↻</button>
          <button className="icon-btn" onClick={() => setShowInfo(true)} title="How Ideas works" aria-label="How Ideas works">ⓘ</button>
        </span>
      </div>

      {/* the three view modes, like the list screen */}
      <div className="segmented" role="tablist" aria-label="Ideas view">
        <button className={mode === "expiring" ? "segmented-on" : ""} onClick={() => setMode("expiring")}>
          Expiring
        </button>
        <button className={mode === "all" ? "segmented-on" : ""} onClick={() => setMode("all")}>
          Use It All
        </button>
        <button className={mode === "byfood" ? "segmented-on" : ""} onClick={() => setMode("byfood")}>
          By Food
        </button>
      </div>

      {isMock && (
        <div className="notice notice-mock">
          Demo ideas (mock generator). Add a free <code>GEMINI_API_KEY</code> to <code>server/.env</code> for real AI recipes.
        </div>
      )}
      {view?.error && <div className="notice notice-error">{view.error}</div>}

      {/* first-run generation: show loader */}
      {!cache && generating && (
        <div className="empty">
          <div className="spinner" />
          <p className="empty-title">Cooking up ideas…</p>
          <p>The AI is peeking inside your fridge. Back in a few seconds.</p>
        </div>
      )}

      {/* nothing in the kitchen at all */}
      {view && !generating && pantryEmpty && (
        <div className="empty">
          <div className="empty-emoji">🧺</div>
          <p className="empty-title">Your pantry is empty</p>
          <p>Add some food (＋ tab) and the AI will plan meals around it — expiring or not.</p>
        </div>
      )}

      {/* "Expiring" tab, but nothing expires soon — other tabs still work */}
      {view && !generating && !pantryEmpty && mode === "expiring" && expiringCount === 0 && (
        <div className="empty">
          <div className="empty-emoji">✨</div>
          <p className="empty-title">All clear</p>
          <p>
            Nothing expires in the next 7 days, so there are no urgency ideas here.
            Switch to <b>Use It All</b> or <b>By Food</b> anytime — those work whatever the dates.
          </p>
        </div>
      )}

      {/* selected mode has no ideas yet (foods exist, generation done, no error) */}
      {view && !generating && !pantryEmpty && !(mode === "expiring" && expiringCount === 0) && !view.error && cache && modeEmpty && (
        <div className="empty">
          <div className="empty-emoji">🤔</div>
          <p className="empty-title">No ideas here yet</p>
          <p>Try the other views, or tap ↻ for a fresh batch.</p>
        </div>
      )}

      {/* showing ideas while a newer set cooks up */}
      {ideas.length > 0 && !pantryEmpty && !(mode === "expiring" && expiringCount === 0) && (
        mode === "byfood" ? (
          perFoodEntries.map(([id, list]) => {
            const f = foodById.get(id)!;
            const d = daysUntil(f.expDate);
            const open = openFoods.has(id);
            return (
              <div className="food-group" key={id}>
                <button className={`food-group-head ${open ? "food-group-head-open" : ""}`} onClick={() => toggleFood(id)} aria-expanded={open}>
                  <span className="food-group-name">{f.name}</span>
                  <span className={`food-group-date ${d < 0 ? "group-title-red" : ""}`}>
                    {d < 0 ? `expired ${formatExpDate(f.expDate)}` : d > 7 ? `best by ${formatExpDate(f.expDate)}` : `expires ${formatExpDate(f.expDate)}`}
                  </span>
                  <span className={`chevron ${open ? "chevron-down" : ""}`} aria-hidden>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <ul className="card-list food-group-body">
                    {list.map((idea) => (
                      <IdeaCard key={idea.title} idea={idea} onOpen={() => setOpenIdea(idea)} foodName={foodName} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        ) : (
          <ul className="card-list">
            {modeIdeas.map((idea) => (
              <IdeaCard key={idea.title} idea={idea} onOpen={() => setOpenIdea(idea)} foodName={foodName} />
            ))}
          </ul>
        )
      )}

      {/* foods exist but generation never produced a cache (e.g. after an error) */}
      {view && !generating && pantryEmpty === false && ideas.length === 0 && !view.error && !cache && (
        <div className="empty">
          <p className="empty-title">No ideas yet</p>
          <p>Tap ↻ to try generating again.</p>
        </div>
      )}

      {showInfo && <InfoSheet onClose={() => setShowInfo(false)} />}

      {openIdea && (
        <RecipeFull
          idea={openIdea}
          unit={unit}
          setUnit={setUnit}
          onBack={() => setOpenIdea(null)}
          foodName={foodName}
        />
      )}
    </section>
  );
}
