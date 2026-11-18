# SnackTime 🥕

Reduce food waste: log food + expiration dates, see what's expiring soon, and get
**AI recipe ideas** (Gemini) for using it up — 3 combined "Use It All" meals plus
2 solo ideas per expiring food. Weekly digest emails coming (real sending = T12).

**Live app:** https://snacktime.pages.dev
**Repo:** https://github.com/williamhm412/snacktime (public)

## Architecture

| Piece | Tech | Where |
|---|---|---|
| Frontend | React + Vite (TypeScript) | `client/` → built to `client/dist` |
| Backend API | Cloudflare Pages Functions | `functions/api/[[path]].ts` |
| Shared logic (store, AI, validation) | TypeScript | `shared/api-core.ts` |
| Database | Cloudflare Workers KV (`SNACKTIME_DB`) | per-user keys: `foods:<user>`, `ideas:<user>`, lock, outbox |
| AI recipes | Gemini free tier (`gemini-3.5-flash`) | key stored as Pages **secret** `GEMINI_API_KEY` |
| Hosting | Cloudflare Pages | project `snacktime` → snacktime.pages.dev |

Config lives in `wrangler.toml` (KV namespace id + output dir).

### Users (temporary identity, T37)

The app asks "Who are you?" on first open (searchable: William, Ammon, McKay,
Dr. Lignell, Guest). The choice rides on every request as the `X-Snacktime-User`
header; all data routes 401 without a valid one. Named users get permanent
per-user KV keys (same pantry on every device). Guest gets a random id kept in
`sessionStorage` + KV entries with a 12 h TTL — closing the page = fresh blank
session. Switch person via the name chip (top-right). This is a courtesy
divider, not authentication — real auth would be T15.

Notes:
- AI responses must match a strict recipe JSON schema (prep/cook time, servings,
  ingredients with BOTH volume + weight measures, instructions, comments); invalid
  output is retried once, then rejected with a friendly error.
- AI ideas: three tabs — **Expiring** (default; meals around food ≤7 days out),
  **Use It All** (meals around the whole pantry, any dates), **By Food** (2 solo
  ideas per food). Generation is client-driven AND lazy: the AI only runs when
  the Ideas tab opens with a changed list (or ↻). Model: gemini-3.5-flash-lite
  (fallback 3.1-flash-lite), maxOutputTokens 16k with token-budget prompt rules.
- Weekly email is a dev stub (digest saved to KV `outbox:latest`). Pages has no
  cron — wire real email + a scheduler in T12 (options: external cron hitting
  `/api/email/send-now`, or move to a full Worker with Cron Triggers).

## Local development

```bash
npm install
npm run dev        # starts BOTH:
                   #  - wrangler pages dev  → API on :8788 (local KV simulation)
                   #  - vite dev            → UI on :5173 (or :5174 if busy)
```

Open the Vite URL it prints (check the port — other projects may grab 5173).
Local AI runs in **mock mode** (no key loaded) — set `GEMINI_API_KEY` in a root
`.dev.vars` file to test real Gemini locally.

## Deploy

```bash
npm run deploy     # build client + wrangler pages deploy client/dist
```

Then push code too: `git add -A && git commit && git push`.
(Prod secret management: `npx wrangler pages secret put GEMINI_API_KEY --project-name=snacktime`)

## Notes for the week

- 2026-11-14: T37 identity gate (per-user cloud pantries + ephemeral guest).
  Verified in prod: isolation (401 w/o header), migration, guest blank/TTL,
  ideas generation per user. Gemini had a transient overload episode (~4 min
  hang → zombie lock, self-heals via 600s TTL); rerun generated 11 ideas in 30s.

## API

- `GET /api/foods?sort=added|expiry`
- `POST /api/foods` — `{ "name": "...", "expDate": "YYYY-MM-DD" }`
- `DELETE /api/foods/:id`
- `GET /api/ideas` — cached ideas + generating status
- `POST /api/ideas/refresh` — `{view, startGeneration}`; regenerate if stale; `{ "force": true }` = new batch, no repeats
- `POST /api/ideas/generate` — SYNCHRONOUS generation (client holds the request open; runs while live)
- `POST /api/email/send-now` — build weekly digest (dev stub → KV outbox)
- `GET /api/health`

## Docs

- `planning.txt` — original product plan · `planning_from_AI.txt` — build notes
- `taks.txt` — running task tracker
