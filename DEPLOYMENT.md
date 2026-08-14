# Deployment

MealMind is two things that deploy differently: a Next.js frontend (stateless, deploys cleanly to Vercel) and a set of Python agents/workflows (currently invoked as local subprocesses, which does **not** carry over to Vercel's serverless runtime as-is — see [§4](#4-running-the-python-agents-in-production) before you assume "deploy to Vercel" means "the whole app is live").

## 1. Vercel project setup

This repo deploys from its root with a root-level [`vercel.json`](vercel.json) that points the build at `frontend/`, so no manual "Root Directory" configuration is needed in the Vercel dashboard:

1. In the Vercel dashboard, **Add New → Project**, import this GitHub repo.
2. Leave **Root Directory** at its default (the repo root) — `vercel.json`'s `installCommand`/`buildCommand`/`outputDirectory` already `cd frontend` and point the build output at `frontend/.next`. Don't set Root Directory to `frontend` in the dashboard as well; that would make Vercel look for `vercel.json` inside `frontend/` instead of at the repo root, and double up the `cd frontend` in the commands.
3. Framework Preset should auto-detect as **Next.js** (also pinned explicitly via `"framework": "nextjs"` in `vercel.json`).
4. Deploy. The first deploy will fail at runtime on any route that hits Supabase until the environment variables in §2 are set — that's expected, add them and redeploy.

*(Alternative, not what's configured here: set Root Directory to `frontend` in the dashboard instead, and move a simpler `vercel.json` — or none at all, since Next.js needs no config for a standard build — inside `frontend/`. Either approach works; don't mix them.)*

## 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production, and Preview if you want preview deploys to work against the same Supabase project):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |

See [`frontend/.env.production.example`](frontend/.env.production.example) for the local-file equivalent (e.g. for `vercel env pull`).

That's genuinely the complete list the Next.js app itself needs — grep confirms `frontend/` only ever reads `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` directly (in `lib/supabase/{client,server,middleware}.ts`). `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_KEY`, and `THEMEALDB_API_KEY` are consumed by the Python agents, not by Next.js — they belong wherever the Python side actually runs (§4), **not** in Vercel's environment variables. In particular, never put `SUPABASE_SERVICE_KEY` (bypasses RLS) in a Vercel env var that a Next.js/edge process can read unless a server-only code path genuinely needs it — today, nothing in `frontend/` does.

## 3. Supabase production settings

1. **Schema**: confirm both migrations are applied (Supabase dashboard → SQL Editor, or `supabase db push` if the project is linked) — `database/migrations/0001_init.sql` (tables, RLS, the `recipes` pgvector index) and `database/migrations/0002_match_recipes.sql` (the `match_recipes` RPC the meal recommender depends on). See `database/SETUP.md` for the original setup walkthrough.
2. **Auth → URL Configuration**: add the production Vercel URL to both fields —
   - **Site URL**: `https://[LIVE_URL]`
   - **Redirect URLs**: `https://[LIVE_URL]/auth/callback` (in addition to the existing `http://localhost:3000/auth/callback` for local dev — keep both, don't replace one with the other)
3. **Google OAuth client** (Google Cloud Console): no change needed here — its authorized redirect URI points at Supabase's own fixed callback (`https://<project-ref>.supabase.co/auth/v1/callback`), which doesn't change when the frontend's deployment URL changes. Only the Supabase-side redirect URLs in step 2 need the new domain.
4. **RLS**: already enabled with per-user policies from `0001_init.sql` — nothing to change for deployment, just confirm in Table Editor that all five tables still show "RLS enabled" (same check as the original setup doc).
5. **Recipe corpus**: if this is a fresh Supabase project rather than the one already seeded during development, run `database/seed_recipes.py` once against it before the meal recommender/shopping list agents will have anything to retrieve.

## 4. Running the Python agents in production

**This is the part that needs a real decision, not just configuration — read this before treating a Vercel deploy as "done."**

### How it works today (local dev only)

`frontend/app/api/{parse-receipt,recommend,confirm-cook,shopping-list}/route.ts` each spawn a Python subprocess directly:

```ts
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON_BIN = path.join(REPO_ROOT, ".venv", "bin", "python3");
execFile(PYTHON_BIN, [AGENT_SCRIPT, ...args], { cwd: REPO_ROOT });
```

This works when `next dev` runs from `frontend/` inside a full checkout of this repo, next to a `.venv/` with `pip install -r requirements.txt` already run. Every agent test in this repo (`scripts/test_*.py`) exercises the Python side this same way.

### Why that doesn't work on Vercel

Vercel's Node.js Serverless Functions run in ephemeral, isolated containers with no preinstalled Python interpreter and no project `.venv` — there's nothing for `execFile` to spawn. Even setting that aside, `frontend/next.config.ts` now deliberately excludes `agents/`, `workflows/`, `mcp_servers/`, `database/`, `scripts/`, `prompts/`, and `.venv/` from the deployment bundle (pinning `turbopack.root` to `frontend/` itself) — correct for keeping the JS bundle clean, but it also means those files simply aren't present at all in a Vercel deployment, even if a Python runtime somehow were.

Concretely: as configured by this PR, the four routes above will return a 500 in production the moment they try to spawn Python, because there's no Python binary and no agent code present in that environment. Every other route (auth, static pages, the plain-CRUD `pantry-items`/`shopping-list-items` PATCH routes that talk to Supabase directly) is unaffected — those don't touch Python.

### Recommended path forward (not implemented in this PR — deliberately configuration-only)

Run the Python agents as their own always-on service, reachable over HTTPS, on a host built for long-running processes rather than serverless functions — a small VM/droplet, or a platform like Fly.io, Railway, or Render. Concretely:

1. Deploy this repo's Python side (`agents/`, `workflows/`, `mcp_servers/`, `requirements.txt`) to that host; `pip install -r requirements.txt` once at deploy time, not per-request.
2. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `THEMEALDB_API_KEY` as that host's environment variables (this is where they belong — not in Vercel).
3. Wrap the four agent entry points in a small HTTP server (each already has a CLI contract — argv in, JSON on stdout — that maps cleanly onto request/response handlers) and expose it behind HTTPS.
4. Update the four `route.ts` handlers to `fetch()` that service instead of `execFile`-ing a local binary, passing the same arguments they pass today.

A lighter-weight alternative worth naming: Vercel does support Python as its own Serverless Function runtime (functions written *in* Python, deployed as `api/*.py` files — a different mechanism from a Node function spawning a subprocess). That would keep everything on Vercel, but it's not a drop-in fix either — it means rewriting each agent's CLI-argv/stdout-JSON contract as a request handler, and `pdfplumber`'s dependency chain (Pillow, pypdfium2) plus the other Python dependencies would need to fit Vercel's Python runtime's package size and cold-start constraints. Worth evaluating, but out of scope here.

### What works without any further changes

Local development. `next dev` plus a local `.venv` already runs the full pipeline end to end — this is genuinely how the agents "run alongside" the frontend today, and it's not going away; it's how every `scripts/test_*.py` in this repo has been verified. The gap described above is specifically about the *production* Vercel deployment, not local dev.

## Live URL

**[LIVE_URL]** — filled in after the first production deploy (see `README.md`'s Deployment section, which links back here).
