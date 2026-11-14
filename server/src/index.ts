import express from "express";
import { addFood, deleteFood, getFood, listFoods } from "./store.js";
import { scheduleWeeklyEmail, sendWeeklyDigest, daysUntil } from "./email.js";
import { ensureFreshIdeas, getIdeasView, requestGeneration } from "./recipes.js";
import type { SortMode } from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);

// Load server/.env if present (GEMINI_API_KEY, GEMINI_MODEL) — Node 22+ builtin
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
  console.log("[server] loaded .env");
} catch {
  /* no .env — fine, ideas fall back to the mock generator */
}

const app = express();
app.use(express.json());

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00");
  return !Number.isNaN(d.getTime());
}

// ── Foods ────────────────────────────────────────────────────────────────
app.get("/api/foods", (req, res) => {
  const sort: SortMode = req.query.sort === "expiry" ? "expiry" : "added";
  res.json(listFoods(sort));
});

app.post("/api/foods", (req, res) => {
  const { name, expDate } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return res.status(400).json({ error: "name is required (max 200 chars)" });
  }
  if (typeof expDate !== "string" || !isValidDate(expDate)) {
    return res.status(400).json({ error: "expDate must be a valid date (YYYY-MM-DD)" });
  }
  const item = addFood(name, expDate);
  // trigger: a new item just entered the 7-day ideas window
  if (daysUntil(item.expDate) <= 7) requestGeneration("new item entered 7-day window");
  res.status(201).json(item);
});

app.delete("/api/foods/:id", (req, res) => {
  const existing = getFood(req.params.id);
  const removed = deleteFood(req.params.id);
  if (!removed) return res.status(404).json({ error: "food item not found" });
  // trigger: an expiring item was used → keep ideas in sync
  if (existing && daysUntil(existing.expDate) <= 7) requestGeneration("expiring item used/removed");
  res.status(204).end();
});

// ── Email (dev stub) ─────────────────────────────────────────────────────
app.post("/api/email/send-now", (_req, res) => {
  const result = sendWeeklyDigest();
  res.json({ ok: true, ...result });
});

// ── AI recipe ideas ──────────────────────────────────────────────────────
app.get("/api/ideas", (_req, res) => {
  res.json(getIdeasView());
});

// "ensure fresh": regenerates only if stale (new day / changed food list),
// or always when { force: true } (manual refresh button).
app.post("/api/ideas/refresh", async (req, res) => {
  const force = req.body?.force === true;
  await ensureFreshIdeas(force);
  res.json(getIdeasView());
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[server] SnackTime API → http://localhost:${PORT}`);
  scheduleWeeklyEmail();
});
