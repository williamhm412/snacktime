# SnackTime 🥕

A locally hosted app to reduce food waste: log food + expiration dates, see what's
expiring soon, and (soon) get AI recipe ideas for it.

## Run it

```bash
npm install     # once
npm run dev     # starts backend + frontend together
```

Then open **http://localhost:5173** in a browser
(narrow the window to phone width for the app feel).

## Structure

| Part | Where | Notes |
|---|---|---|
| Backend | `server/` | Express API on port 3001 |
| Data | `server/data/foods.json` | plain JSON, updates live as you use the app |
| Email digests | `server/data/outbox/` | weekly digest dev stub (real email later) |
| Frontend | `client/` | React + Vite on port 5173, proxies `/api` to the backend |

## API

- `GET /api/foods?sort=added|expiry` — list food
- `POST /api/foods` — add `{ "name": "...", "expDate": "YYYY-MM-DD" }`
- `DELETE /api/foods/:id` — mark as used / remove
- `POST /api/email/send-now` — write a weekly-digest file to the outbox on demand
- `GET /api/ideas` — cached AI ideas + status
- `POST /api/ideas/refresh` — regenerate if stale, or `{ "force": true }` to always redo

## AI recipe ideas

Recipes come from **Gemini (free tier)** with a strict JSON schema so responses always
match the app's recipe format. Ideas regenerate automatically when you first open the
Ideas tab each day, when a food enters the 7-day expiry window, and when your list changes.

**Enable real AI (one-time, ~2 minutes):**
1. Get a free key at https://aistudio.google.com/apikey
2. `cp server/.env.example server/.env`
3. Paste the key after `GEMINI_API_KEY=` and restart (`npm run dev`)

Without a key, the Ideas tab shows clearly-labeled *demo* recipes from a built-in mock
so the whole UI still works offline. Cached AI ideas live in `server/data/ideas.json`.

## Docs

- `planning.txt` — the original product plan (yours)
- `planning_from_AI.txt` — build plan + executive summary from me
- `taks.txt` — task tracker, updated as we work
