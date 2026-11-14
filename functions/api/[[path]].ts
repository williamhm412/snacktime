/* SnackTime API — Pages Functions entry for /api/* routes.
   (Static assets — the React app — are served by Pages itself.) */
import type { PagesFunction } from "@cloudflare/workers-types";
import {
  addFood,
  deleteFood,
  generateIdeasNow,
  getIdeasView,
  listFoods,
  parseUser,
  refreshIdeasView,
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
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;
  const method = request.method;

  try {
    /* ── misc (no identity needed) ──────────────────────────────────── */
    if (path === "/api/health") {
      return json({ ok: true, service: "snacktime", ts: Date.now() });
    }

    /* every data route below is scoped to the person chosen in the app */
    const scope = parseUser(request.headers.get("X-Snacktime-User"));
    if (!scope) {
      return json({ error: "who are you? choose a profile first" }, 401);
    }

    /* ── /api/foods ─────────────────────────────────────────────────── */
    if (path === "/api/foods" && method === "GET") {
      const sort: SortMode = new URL(request.url).searchParams.get("sort") === "expiry" ? "expiry" : "added";
      return json(await listFoods(env, scope, sort));
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
      const item = await addFood(env, scope, name, expDate);
      return json(item, 201); // client re-syncs ideas itself (refresh → generate)
    }

    const foodMatch = path.match(/^\/api\/foods\/([\w-]+)$/);
    if (foodMatch && method === "DELETE") {
      const removed = await deleteFood(env, scope, foodMatch[1]);
      if (!removed) return json({ error: "food item not found" }, 404);
      return new Response(null, { status: 204 });
    }

    /* ── /api/ideas ─────────────────────────────────────────────────── */
    if (path === "/api/ideas" && method === "GET") {
      return json(await getIdeasView(env, scope));
    }

    if (path === "/api/ideas/refresh" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return json(await refreshIdeasView(env, scope, body?.force === true));
    }

    // synchronous generation: the client holds this request open while the AI works
    if (path === "/api/ideas/generate" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return json(await generateIdeasNow(env, scope, body?.force === true));
    }

    /* ── /api/email (dev stub) ──────────────────────────────────────── */
    if (path === "/api/email/send-now" && method === "POST") {
      return json({ ok: true, ...(await sendWeeklyDigest(env, scope)) });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
};
