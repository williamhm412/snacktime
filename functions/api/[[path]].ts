/* SnackTime API — Pages Functions entry for /api/* routes.
   (Static assets — the React app — are served by Pages itself.) */
import type { PagesFunction } from "@cloudflare/workers-types";
import {
  addFood,
  daysUntil,
  deleteFood,
  ensureFreshIdeas,
  getIdeasView,
  listFoods,
  sendWeeklyDigest,
  type Env,
  type SortMode,
} from "../../shared/api-core.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  return !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, next } = ctx;
  const path = new URL(request.url).pathname;
  const method = request.method;

  try {
    /* ── /api/foods ─────────────────────────────────────────────────── */
    if (path === "/api/foods" && method === "GET") {
      const sort: SortMode = new URL(request.url).searchParams.get("sort") === "expiry" ? "expiry" : "added";
      return json(await listFoods(env, sort));
    }

    if (path === "/api/foods" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const { name, expDate } = body;
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
        return json({ error: "name is required (max 200 chars)" }, 400);
      }
      if (!isValidDate(expDate)) {
        return json({ error: "expDate must be a valid date (YYYY-MM-DD)" }, 400);
      }
      const item = await addFood(env, name, expDate);
      // keep ideas in sync without delaying the response (client also re-syncs)
      if (daysUntil(item.expDate) <= 7) {
        ctx.waitUntil(ensureFreshIdeas(env, ctx.waitUntil));
      }
      return json(item, 201);
    }

    const foodMatch = path.match(/^\/api\/foods\/([\w-]+)$/);
    if (foodMatch && method === "DELETE") {
      const removed = await deleteFood(env, foodMatch[1]);
      if (!removed) return json({ error: "food item not found" }, 404);
      if (daysUntil(removed.expDate) <= 7) {
        ctx.waitUntil(ensureFreshIdeas(env, ctx.waitUntil));
      }
      return new Response(null, { status: 204 });
    }

    /* ── /api/ideas ─────────────────────────────────────────────────── */
    if (path === "/api/ideas" && method === "GET") {
      return json(await getIdeasView(env));
    }

    if (path === "/api/ideas/refresh" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return json(await ensureFreshIdeas(env, ctx.waitUntil, body?.force === true));
    }

    /* ── /api/email (dev stub) ──────────────────────────────────────── */
    if (path === "/api/email/send-now" && method === "POST") {
      return json({ ok: true, ...(await sendWeeklyDigest(env)) });
    }

    /* ── misc ───────────────────────────────────────────────────────── */
    if (path === "/api/health") {
      return json({ ok: true, service: "snacktime", ts: Date.now() });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
};
