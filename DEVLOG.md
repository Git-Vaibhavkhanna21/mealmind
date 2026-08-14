# DEVLOG

## PR #1 — Initial project scaffold
### What was built
Folder structure established before any code was written — `agents/`, `mcp_servers/`, `workflows/`, `prompts/`, `database/`, `frontend/`. Next.js initialized with TypeScript, Tailwind, App Router, four placeholder routes.

### Architectural decisions
Designing the folder structure before writing any agent code signals that the system was architected first and built second. Each folder maps to a distinct architectural layer.

### Bugs found and fixed
None.

## PR #2 — README
### What was built
Full architectural README documenting all seven sections including agent pipeline, model selection rationale, MCP server decisions, database schema, and roadmap.

### Architectural decisions
Written for a technical interviewer, not a general user.

### Bugs found and fixed
None.

## PR #3 — Supabase schema and Google Auth
### What was built
Five tables created with RLS on all of them. Google OAuth via Supabase Auth. On first login, a `users` row is provisioned and the user is routed to onboarding. On subsequent logins, routed directly to pantry.

### Architectural decisions
The `recipes` table uses a different RLS policy than the other four tables — read-only for any authenticated user rather than owner-scoped — because `recipes` is a shared catalog, not user-owned data. The other four tables (`users`, `pantry_items`, `user_recipe_history`, `shopping_list_items`) are strictly owner-scoped.

### Bugs found and fixed
None.

## PR #4 — TheMealDB MCP server and recipe seed
### What was built
MCP server for TheMealDB in `mcp_servers/recipe_database.py`. One-time seed script fetching 200 recipes across 14 categories with a top-up mechanism to ensure exactly 200. Embeddings generated using OpenAI `text-embedding-3-small` at 1536 dimensions.

### Architectural decisions
Voyage AI is Anthropic's recommended embeddings partner, but `voyage-3` outputs 1024 dimensions natively. The schema was already set to `vector(1536)`. OpenAI `text-embedding-3-small` was the correct choice for exact dimension matching without padding or truncation.

### Bugs found and fixed
None.

## PR #5 — Receipt parsing workflow and pantry UI
### What was built
Receipt parsing implemented as a workflow not an agent — input is a receipt, output is a structured item list, no reasoning required. Haiku handles extraction deterministically. Expiration workflow uses Haiku for common items in a batch call, escalates to a Sonnet subagent for unknown or ambiguous items — the subagent returns only the result, keeping the main context clean. Pantry inventory MCP server created because multiple agents read and write pantry data — centralising the connection means schema changes and authentication are managed in one place.

### Architectural decisions
Receipt parsing is deterministic control flow (OCR/extraction → validate → persist), so it belongs in `workflows/`, not `agents/` — the reasoning step (turning unstructured receipt content into structured items) is delegated to Haiku, but the sequencing itself never branches on model output. The pantry inventory MCP server exists specifically because pantry data is read and written by more than one agent — centralising that connection is the same rationale as the recipe MCP server, applied to a second shared resource.

### Bugs found and fixed
`create-next-app` initialized a nested `.git` directory inside `frontend/` despite the `--no-git` flag. Detected and removed before committing to prevent a nested repository inside the parent repo.

## PR #6 — Meal recommendation agent with RAG
### What was built
Query constructed from pantry state sorted by expiry date ascending, user cooking skill, dietary restrictions, and max cooking time. Query embedded with OpenAI `text-embedding-3-small`. pgvector cosine similarity search retrieves 10 candidate recipes. Sonnet selects 3 and provides per-recipe rationale referencing specific pantry items. Custom recipe path accepts free text, embeds it, runs the same retrieval, and Sonnet judges whether to return 1 or 3 recipes based on whether the request specifies a single dish.

### Architectural decisions
Ranking retrieved recipes against pantry contents, expiring items, and user preferences is an open-ended judgment call with no fixed rule for "best meal to cook tonight," so the final selection is delegated to Sonnet rather than hard-coded — but Sonnet is only ever handed a pgvector-narrowed shortlist (10 candidates), not the full recipe catalog, keeping the reasoning step's token cost bounded regardless of catalog size.

### Bugs found and fixed
**Bug 1:** Sonnet occasionally prefaced JSON responses with prose, breaking `json.loads`. Fixed with `_extract_json_list`, which scans for the first `[` and last `]` characters regardless of surrounding text. This is the correct production approach — language models are non-deterministic and robust parsers never assume clean output.

**Bug 2:** The ivfflat index was created with `lists=100` on a 200-recipe table, dividing recipes into 100 near-empty buckets. Vector search was probing a handful of near-empty buckets and returning almost no candidates. Sonnet was hallucinating recipe IDs when given an empty candidate list. Fixed by forcing near-exhaustive probing inside the `match_recipes` RPC function. Root cause: ivfflat's speed advantage only materialises at tens of thousands of rows. At 200 rows, `lists=100` pays the accuracy cost without the speed benefit. At scale, the correct fix is to reduce `lists` proportionally to dataset size, or switch to HNSW, which handles small-to-medium datasets more gracefully.

## PR #7 — CLAUDE.md with persistent project conventions
### What was built
`CLAUDE.md` created at project root with five sections: project overview, branching convention, devlog update instruction, agent and model conventions, MCP conventions.

### Architectural decisions
Claude Code reads this file automatically at the start of every session — conventions are persistent without needing to be repeated in every prompt.

### Bugs found and fixed
None.

## PR #9 — Cook confirmation and pantry deduction
### What was built
`agents/pantry_deductor.py`: fuzzy-matches a recipe's ingredients against the user's pantry stock using Haiku, returning a deduction plan (`pantry_item_id`, `pantry_item_name`, `quantity_to_deduct`, `unit`, `confidence`) for review before anything is deducted. `apply_deduction` executes a confirmed plan — subtracts quantities, flips `is_depleted` when stock hits zero, and records the cook in `user_recipe_history` (`cooked_at`, `confirmed_cooked`). `app/api/confirm-cook/route.ts` exposes both steps behind one route: an unconfirmed request builds and returns the plan for review, a confirmed request (echoing the reviewed plan back) applies it. `/recipes` gained a "Cook This" button per card that opens a confirmation modal showing the deduction plan, with a confidence badge per match — amber below 70%, green at or above — and Confirm Cook / Cancel actions. `/pantry` gained a per-item Edit button opening an inline form to adjust quantity or toggle `is_depleted` manually, backed by a new `app/api/pantry-items/[id]/route.ts` PATCH route. `scripts/test_pantry_deduction.py` simulates cooking "Chickpea, chorizo & spinach stew" against the same seeded test pantry used elsewhere, asserting a high-confidence spinach match, a correct deduction, and a confirmed cook in history.

### Architectural decisions
Fuzzy ingredient matching ("fresh spinach" vs. a pantry item named "spinach") is a judgment call that benefits from a small, fast model — Haiku fits the same profile as the extraction work in `agents/parser.py`, one bounded call per confirmation rather than open-ended reasoning. Splitting the feature into a plan step (judgment, Haiku) and an apply step (deterministic arithmetic, no model call) keeps the model in the loop only where matching actually requires interpretation, and keeps the deduction itself auditable and re-runnable. The manual pantry edit endpoint is the one route in the app that talks to Supabase directly from Next.js rather than shelling out to Python — it's plain single-table CRUD scoped to the caller by RLS, with no model reasoning and no cross-agent sharing, so routing it through Python would add a subprocess hop for no benefit.

### Bugs found and fixed
None — `_extract_json_list`'s tolerant parsing (scan for `[...]` rather than assuming clean JSON) was carried over from `agents/meal_recommender.py` from the start, so the prose-prefixed-response failure mode that surfaced there didn't recur here.

## PR #10 — Shopping list agent
### What was built
`agents/shopping_list.py`: reads the user's non-depleted pantry (via `mcp_servers/pantry_inventory`), their last 10 confirmed-cooked recipes with ingredients (`user_recipe_history` joined to `recipes`), and their `cooking_skill`/`dietary_restrictions`, then asks `claude-sonnet-4-6` to suggest items — each with `name`, `quantity`, `unit`, and a one-sentence `rationale` explaining whether it replenishes something running low, complements what's already on hand, or re-enables a dish cooked before. Persisting a new list deletes the previous unpurchased items and inserts the new batch, leaving anything already marked purchased untouched as history. `app/api/shopping-list/route.ts` triggers the agent; `app/api/shopping-list-items/[id]/route.ts` toggles `purchased` directly via the RLS-scoped client. `/shopping-list` displays the list with a checkbox per item and a Regenerate button. `scripts/test_shopping_list.py` runs the agent against the existing (unmodified) test user's pantry and history and prints the full list with rationales.

### Architectural decisions
The old stub signature (`build_list(planned_meals, pantry_items)`) assumed a fixed meal plan to diff against pantry stock — closer to set arithmetic than judgment. The actual spec asks for something more open-ended: weighing three different kinds of signal (replenishment, complementary pantry rounding-out, re-enabling a past dish) with no fixed rule for combining them. That's the same shape of reasoning as `agents/meal_recommender.py`, so the model choice moved from Haiku (documented for "fuzzy ingredient-name matching") to Sonnet, and the README's description of this agent and its model choice were updated to match. As with the pantry edit route, `shopping-list-items/[id]/route.ts`'s purchased toggle is plain RLS-scoped CRUD and talks to Supabase directly rather than through Python.

### Bugs found and fixed
None — verified the trickiest part of the persistence logic (regenerating replaces unpurchased items but leaves purchased ones alone) directly against Supabase: marked one item purchased, regenerated, and confirmed the purchased row survived untouched while all 12 unpurchased rows were replaced.

## PR #11 — Vercel deployment configuration
### What was built
Root-level `vercel.json` pointing the build at `frontend/` (custom `installCommand`/`buildCommand`/`outputDirectory`, `framework: "nextjs"`) so the app deploys from the repo root without a dashboard Root Directory override. `frontend/.env.production.example` documenting the two environment variables the Next.js app actually needs (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — confirmed by grep that nothing else in `frontend/` reads `process.env` directly. `frontend/next.config.ts` now pins `turbopack.root` to the frontend directory itself, making explicit that the Python agents one level up are never part of the deployment bundle. `DEPLOYMENT.md` documents the full production setup — Vercel project config, environment variables, Supabase production settings (redirect URLs, migrations, RLS, recipe seeding) — and a `README.md` "Deployment" section with a `[LIVE_URL]` placeholder pointing at it.

### Architectural decisions
`DEPLOYMENT.md` documents, rather than papers over, a real gap: every Next.js API route that touches an agent (`parse-receipt`, `recommend`, `confirm-cook`, `shopping-list`) works today by spawning a local Python subprocess (`.venv/bin/python3 <script>`), which has no equivalent on Vercel — serverless Node functions have no Python interpreter or project `.venv`, and (correctly, for bundle hygiene) `next.config.ts`'s `turbopack.root` pin now excludes the Python directories from the deployment entirely. Rather than leave this implicit or claim a config-only PR fixes it, `DEPLOYMENT.md` names the failure mode precisely and recommends the actual fix — running the Python agents as their own always-on HTTP service on a host built for long-running processes, with the four routes calling it over `fetch()` instead of `execFile` — as follow-up work outside this PR's scope (configuration only, per the task).

### Bugs found and fixed
`next.config.ts`'s first attempt used `outputFileTracingExcludes` with `../agents/**/*`-style parent-relative globs — this is the pattern shown in Next.js's own docs for excluding files from a serverless function's trace, but running an actual `next build` (Turbopack) failed immediately: `glob '../agents/**/*' is invalid, it has a prefix that navigates out of the project root`. Turbopack rejects exclude globs that reach outside the project root — and doesn't need to reach outside it here anyway, since files outside the default tracing root (the Next.js project directory) are excluded from every trace by default. Replaced with `turbopack.root: __dirname`, which pins that default boundary explicitly instead of trying to exclude paths that were never reachable in the first place; a full `next build` was re-run to confirm it now completes cleanly.

## PR #12 — FastAPI service for Railway deployment
### What was built
`api/main.py`: a FastAPI service wrapping every Python agent/workflow behind six HTTP endpoints — `POST /parse-receipt` (multipart file/text → `workflows.receipt_parsing.run`), `POST /recommend` and `POST /custom-recipe` (→ `agents.meal_recommender.recommend`/`generate_custom_recipe`), `POST /confirm-cook` (preview and confirm modes → `agents.pantry_deductor.build_deduction_plan`/`apply_deduction`), `POST /shopping-list` (→ `agents.shopping_list.generate_shopping_list`), and `PATCH /pantry-items/{id}` (direct Supabase update). Every endpoint validates the caller-supplied `user_id` against the `users` table before doing anything else. `api/requirements.txt`, a root-level `Procfile` and `railway.json` configure it for Railway. All six Next.js API routes (`parse-receipt`, `recommend`, `confirm-cook`, `shopping-list`, `pantry-items/[id]`, plus a new `custom-recipe`) were rewritten from `execFile`-ing a local Python subprocess to `fetch()`-ing this service, through a shared `frontend/lib/python-api.ts` client. `DEPLOYMENT.md`'s §4 — previously a "known limitation" writeup about this exact gap — now documents the actual Railway setup and how `PYTHON_API_URL` connects the two deployed services.

### Architectural decisions
Splitting `recommend` into two Next.js routes (`recommend` and a new `custom-recipe`) mirrors the FastAPI service's own endpoint split 1:1, rather than keeping one Next.js route that internally branches on a `request` field the way the old subprocess-based version did — cleaner on both sides of the HTTP boundary than smuggling a mode flag through one endpoint. `PATCH /pantry-items/{id}` moved into the FastAPI service even though its Next.js route was never subprocess-based (it always talked to Supabase directly) — the task's endpoint list asked for it explicitly, consolidating all pantry writes behind one backend rather than splitting "some routes call Python, one calls Supabase directly." `shopping-list-items/[id]`'s purchased-toggle route was deliberately left alone: no FastAPI endpoint was requested for it, and as plain RLS-scoped CRUD with no agent involved, there's nothing about "spawns Python subprocesses" that applies to it in the first place.

Added a shared-secret header (`INTERNAL_API_KEY`, checked by `_require_internal_api_key` on every endpoint) beyond what was asked for. The FastAPI service authenticates to Supabase with the service role key (bypasses RLS) and accepts a caller-supplied `user_id` on every endpoint; without a check binding the caller to "this is actually the Next.js deployment," anyone who found the Railway URL could read or write any user's private data by supplying their id — a real vulnerability introduced by this exact PR's architecture, not a pre-existing or theoretical one, so it was in scope to fix rather than flag and leave.

### Bugs found and fixed
None — every endpoint was verified live (see test plan in the PR) before being wired into the Next.js layer, so issues were caught during that direct testing rather than after the fact.

## PR #14 — Restructure: move Python service files into api/ for Railway deployment
### What was built
Moved `agents/`, `workflows/`, `mcp_servers/`, and `prompts/` from the repo root into `api/agents/`, `api/workflows/`, `api/mcp_servers/`, and `api/prompts/` via `git mv` (preserving history), making `api/` a fully self-contained Python service rather than depending on sibling directories one level up. Fixed `api/main.py`'s `sys.path.insert` (was adding the repo root via `dirname(dirname(__file__))`; now adds `api/` itself via a single `dirname(__file__)`, since agents/workflows are now direct children of `api/` rather than the repo root). The internal `sys.path.insert(0, dirname(dirname(__file__)))` calls inside the moved agent/workflow files needed no code changes — since the whole directory shifted one level deeper, that same "go up two levels" computation now automatically lands on `api/` instead of the repo root. `database/seed_recipes.py` and all three `scripts/test_*.py` files (not explicitly listed in the restructuring task, but importing from `agents`/`mcp_servers` and would otherwise break) had their imports updated to `api.agents`/`api.mcp_servers`. Updated prose path references in docstrings across the moved files, and in `README.md`/`DEPLOYMENT.md`, to the new `api/`-prefixed locations.

### Architectural decisions
This reverses the topology PR #12 deliberately set up (Railway Root Directory at the repo root, so `api/main.py` could import `agents/`/`workflows/`/`mcp_servers/` as siblings) in favor of the one PR #13 anticipated (Root Directory at `api/`, with `api/nixpacks.toml`/`api/railway.json` living inside `api/`). The two approaches were fundamentally incompatible — a Railway service rooted at `api/` never has access to sibling directories outside it, regardless of how the start command is written — so PR #13's config was, on its own, deploying an app that could never resolve its own imports. This PR is what makes that config actually work: `api/` now contains everything it needs, so scoping Railway's build to `api/` no longer excludes anything `api/main.py` depends on. The original structure placed the Python service files at repo root level, which is exactly what caused Railway to be unable to resolve sibling imports once deploying from the `api/` subdirectory — moving everything into `api/` removes that mismatch at the source instead of continuing to work around it.

### Bugs found and fixed
None — verified via the exact command requested (`python3 -c "from api.agents.meal_recommender import recommend; print('imports OK')"`) plus a fuller pass: importing `api.main` directly and checking all six routes registered, starting `uvicorn main:app` from within `api/` (the actual Railway invocation) and confirming `/docs` and `/parse-receipt` both work end to end against live Supabase/Anthropic, and importing all three `scripts/test_*.py` and `database/seed_recipes.py` to confirm their updated imports resolve.

## How this log is maintained
CLAUDE.md instructs Claude Code to update this file at the end of every PR before the final commit. Each entry documents what was built, architectural decisions and reasoning, and bugs found and fixed. Written for a technical interviewer reading the public repository.
