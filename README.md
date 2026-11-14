# SnackTime 🥕

Reduce food waste: log food + expiration dates, see what's expiring soon, and get
**AI recipe ideas** (Gemini) for using it up — 3 combined "Use It All" meals plus
2 solo ideas per expiring food. Weekly digest emails coming (real sending = T12).

**Live app:** https://snacktime.pages.dev
**Repo:** https://github.com/williamhm412/snacktime (private)

## Architecture

| Piece | Tech | Where |
|---|---|---|
| Frontend | React + Vite (TypeScript) | `client/` → built to `client/dist` |
| Backend API | Cloudflare Pages Functions | `functions/api/[[path]].ts` |
| Shared logic (store, AI, validation) | TypeScript | `shared/api-core.ts` |
| Database | Cloudflare Workers KV (`SNACKTIME_DB`) | keys: `foods`, `ideas`, outbox, lock |
| AI recipes | Gemini free tier (`gemini-3.5-flash`) | key stored as Pages **secret** `GEMINI_API_KEY` |
| Hosting | Cloudflare Pages | project `snacktime` → snacktime.pages.dev |

Config lives in `wrangler.toml` (KV namespace id + output dir).

Notes:
- AI responses must match a strict recipe JSON schema (prep/cook time, servings,
  ingredients with BOTH volume + weight measures, instructions, comments); invalid
  output is retried once, then rejected with a friendly error.
- Ideas regenerate automatically: first Ideas-tab open each day, when food enters
  the 7-day window, and when your list changes. Manual ↻ additionally forbids the
  AI from reusing the current ideas.
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

## API

- `GET /api/foods?sort=added|expiry`
- `POST /api/foods` — `{ "name": "...", "expDate": "YYYY-MM-DD" }`
- `DELETE /api/foods/:id`
- `GET /api/ideas` — cached ideas + generating status
- `POST /api/ideas/refresh` — regenerate if stale; `{ "force": true }` = new batch, no repeats
- `POST /api/email/send-now` — build weekly digest (dev stub → KV outbox)
- `GET /api/health`

## Docs

- `planning.txt` — original product plan · `planning_from_AI.txt` — build notes
- `taks.txt` — running task tracker
