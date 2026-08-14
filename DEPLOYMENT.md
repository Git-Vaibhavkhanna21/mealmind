# Deployment

MealMind is two services: a Next.js frontend (deploys to Vercel) and a FastAPI service (`api/`, deploys to Railway) — a fully self-contained Python service: `api/agents/`, `api/workflows/`, `api/mcp_servers/`, and `api/prompts/` all live inside it, not at the repo root. They're separate services because Vercel's serverless functions have no Python interpreter to spawn a subprocess into — see [§4](#4-railway-deployment-fastapi-service) for why that matters and what used to be a gap here.

## 1. Vercel project setup

This repo deploys from its root with a root-level [`vercel.json`](vercel.json) that points the build at `frontend/`, so no manual "Root Directory" configuration is needed in the Vercel dashboard:

1. In the Vercel dashboard, **Add New → Project**, import this GitHub repo.
2. Leave **Root Directory** at its default (the repo root) — `vercel.json`'s `installCommand`/`buildCommand`/`outputDirectory` already `cd frontend` and point the build output at `frontend/.next`. Don't set Root Directory to `frontend` in the dashboard as well; that would make Vercel look for `vercel.json` inside `frontend/` instead of at the repo root, and double up the `cd frontend` in the commands.
3. Framework Preset should auto-detect as **Next.js** (also pinned explicitly via `"framework": "nextjs"` in `vercel.json`).
4. Deploy. The first deploy will fail at runtime on any route that touches Supabase or the Python API until the environment variables in §2 are set — that's expected, add them and redeploy. Deploy the Railway service (§4) first if you want everything working on the first Vercel deploy, since §2's `PYTHON_API_URL` depends on it.

*(Alternative, not what's configured here: set Root Directory to `frontend` in the dashboard instead, and move a simpler `vercel.json` — or none at all, since Next.js needs no config for a standard build — inside `frontend/`. Either approach works; don't mix them.)*

## 2. Environment variables (Vercel)

Set these in **Vercel → Project → Settings → Environment Variables** (Production, and Preview if you want preview deploys to work against the same backend):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `PYTHON_API_URL` | The Railway service's public URL from §4, e.g. `https://<service>.up.railway.app` (no trailing slash) |
| `INTERNAL_API_KEY` | Any long random string — must be the **exact same value** set on the Railway service in §4 |

See [`frontend/.env.production.example`](frontend/.env.production.example) for the local-file equivalent (e.g. for `vercel env pull`).

Grep confirms `frontend/` only reads `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` directly (in `lib/supabase/{client,server,middleware}.ts`) plus `PYTHON_API_URL`/`INTERNAL_API_KEY` (in `lib/python-api.ts`). `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_KEY`, and `THEMEALDB_API_KEY` are consumed by the Python side and belong in Railway's environment variables (§4), **not** Vercel's — in particular, never put `SUPABASE_SERVICE_KEY` (bypasses RLS) anywhere a Next.js/edge process can read it.

## 3. Supabase production settings

1. **Schema**: confirm both migrations are applied (Supabase dashboard → SQL Editor, or `supabase db push` if the project is linked) — `database/migrations/0001_init.sql` (tables, RLS, the `recipes` pgvector index) and `database/migrations/0002_match_recipes.sql` (the `match_recipes` RPC the meal recommender depends on). See `database/SETUP.md` for the original setup walkthrough.
2. **Auth → URL Configuration**: add the production Vercel URL to both fields —
   - **Site URL**: `https://[LIVE_URL]`
   - **Redirect URLs**: `https://[LIVE_URL]/auth/callback` (in addition to the existing `http://localhost:3000/auth/callback` for local dev — keep both, don't replace one with the other)
3. **Google OAuth client** (Google Cloud Console): no change needed here — its authorized redirect URI points at Supabase's own fixed callback (`https://<project-ref>.supabase.co/auth/v1/callback`), which doesn't change when the frontend's deployment URL changes. Only the Supabase-side redirect URLs in step 2 need the new domain.
4. **RLS**: already enabled with per-user policies from `0001_init.sql` — nothing to change for deployment, just confirm in Table Editor that all five tables still show "RLS enabled" (same check as the original setup doc). Note that the FastAPI service uses the service role key and bypasses RLS entirely by design (§4 explains why that's gated behind `INTERNAL_API_KEY`) — RLS is what protects direct browser/Next.js access to Supabase, not the Python service.
5. **Recipe corpus**: if this is a fresh Supabase project rather than the one already seeded during development, run `database/seed_recipes.py` once against it before the meal recommender/shopping list agents will have anything to retrieve.

## 4. Railway deployment (FastAPI service)

### Background: why this service exists

Every route touching a Python agent (`parse-receipt`, `recommend`, `custom-recipe`, `confirm-cook`, `shopping-list`, and the pantry item edit) used to work by having the Next.js API route spawn a Python subprocess directly (`.venv/bin/python3 <script>`). That's fine for `next dev` on a full local checkout, but Vercel's serverless Node functions have no Python interpreter or project `.venv` to spawn into — those routes would 500 in production. `api/main.py` wraps the same agent code in a FastAPI app that deploys as its own always-on service on Railway (a platform built for long-running processes, unlike Vercel's serverless model), and the Next.js routes now call it over HTTP instead.

### Setup

1. In the Railway dashboard, **New Project → Deploy from GitHub repo**, select this repo.
2. **Settings → Root Directory**: set it to `api/`. `api/` is a fully self-contained Python service — `api/agents/`, `api/workflows/`, `api/mcp_servers/`, and `api/prompts/` all live inside it (not as siblings at the repo root), specifically so a Railway service rooted at `api/` has everything `api/main.py` imports. This is also why [`api/nixpacks.toml`](api/nixpacks.toml) and [`api/railway.json`](api/railway.json) live inside `api/` rather than at the repo root — Railway looks for both wherever Root Directory points, and once that's `api/`, `main:app` (not `api.main:app`) is the correct module path, since `main.py` is the working directory's own top-level module at that point.
3. Railway auto-detects `api/railway.json` (Nixpacks builder) and `api/nixpacks.toml` (start command `uvicorn main:app --host 0.0.0.0 --port $PORT`, no install phase — Nixpacks auto-detects `api/requirements.txt` once it's building from within `api/`) — no further build configuration needed.
4. **Variables**, set:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | From the Anthropic console |
   | `OPENAI_API_KEY` | From the OpenAI dashboard (used for `text-embedding-3-small`) |
   | `SUPABASE_URL` | Same Supabase project URL as Vercel's `NEXT_PUBLIC_SUPABASE_URL` |
   | `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → `service_role` key — **never** set this in Vercel |
   | `THEMEALDB_API_KEY` | `1` (the free tier test key) unless you've bought a real one |
   | `INTERNAL_API_KEY` | Same long random string set as Vercel's `INTERNAL_API_KEY` in §2 |

5. Deploy. Railway assigns a public URL (**Settings → Networking → Generate Domain** if one isn't assigned automatically) — that's the value for Vercel's `PYTHON_API_URL` in §2.
6. Smoke-test it directly before wiring up Vercel:
   ```bash
   curl -X POST https://<service>.up.railway.app/recommend \
     -H "Content-Type: application/json" \
     -H "X-Internal-Api-Key: <your INTERNAL_API_KEY>" \
     -d '{"user_id": "<a real user id from the users table>"}'
   ```
   A `401` means the internal API key doesn't match; a `404` means the `user_id` doesn't exist in `users`; a `200` with a `recipes` array means it's working.

### How `PYTHON_API_URL` and `INTERNAL_API_KEY` connect the two services

- Every Next.js route that needs the Python side calls `frontend/lib/python-api.ts`'s `callPythonApi()`, which does `fetch(\`${PYTHON_API_URL}${path}\`, ...)` with an `X-Internal-Api-Key` header attached. `PYTHON_API_URL` is just "where is the FastAPI service" — Vercel's copy of it points at the Railway deployment.
- `INTERNAL_API_KEY` isn't part of the original spec for this feature — it's a shared secret added because the FastAPI service authenticates its own calls to Supabase with the **service role key** (bypasses RLS) and accepts a caller-supplied `user_id` on every endpoint. Without some check, anyone who found the Railway URL could read or write *any* user's pantry, recipes, or shopping list just by supplying their id in the request body — Railway URLs aren't secret, and this service has no independent way to verify a `user_id` claim the way Supabase's own JWT-based auth does. `api/main.py`'s `_require_internal_api_key` dependency rejects any request missing the header or presenting the wrong value, so only requests originating from this Next.js deployment (the only place `INTERNAL_API_KEY` is configured, in Vercel) are accepted.
- Both values must match exactly between Vercel and Railway. If you rotate `INTERNAL_API_KEY`, update it in both places at once — every request will 401 in between.
- Note that `INTERNAL_API_KEY` gates the *service*, not individual users: Next.js has already authenticated the human via Supabase's session cookie (`supabase.auth.getUser()`) before ever calling the Python API, and forwards that user's real id. `INTERNAL_API_KEY` just proves the *caller* is this app's backend, not a stranger who found the Railway URL — it doesn't re-verify which human is behind the request; the `user_id` existence check in `api/main.py` (`_require_user`) is a lighter sanity check on top of that, not a substitute for it.

## Live URL

**[LIVE_URL]** — filled in after the first production deploy (see `README.md`'s Deployment section, which links back here).
