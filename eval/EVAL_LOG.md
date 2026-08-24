# EVAL_LOG

Manual testing cycles from before the automated eval harness (PR 2) existed.
Each cycle follows the same shape: **Observation → Measurement → Diagnosis →
Fix → Re-measurement** — what was noticed, how it was quantified, why it was
happening, what changed, and what the same measurement showed afterward.

This is the informal predecessor to the automated harness, not a replacement
for it — see `README.md` in this directory for how the two relate.

## Cycle 1 — Vector search returning empty results (PR #6)

**Observed:** Recipe recommendations returning fabricated recipe IDs not
present in the database.

**Measured:** 0/10 recommendations had valid recipe_ids in manual testing —
0% pass rate on the `real_recipe_ids` criterion.

**Diagnosed:** The `ivfflat` index was created with `lists=100` on a
200-row `recipes` table — dividing recipes into 100 near-empty buckets.
Probing returned near-zero candidates, and Sonnet hallucinated recipe IDs
when given an effectively empty candidate list.

**Fix:** Forced near-exhaustive probing inside the `match_recipes` RPC
function. Switched the function to `plpgsql`/`volatile` to allow setting
`ivfflat.probes` inside the function body.

**Re-measured:** 10/10 valid recipe IDs in subsequent manual testing — 100%
pass rate on the `real_recipe_ids` criterion.

## Cycle 2 — Sonnet JSON parsing failures (PR #6)

**Observed:** The meal recommendation endpoint returning 500 errors
intermittently during manual testing.

**Measured:** Approximately 20% failure rate across 10 manual test runs.

**Diagnosed:** Sonnet occasionally prefaced its JSON array response with a
prose sentence, causing `json.loads()` to fail on valid-but-prose-prefixed
output.

**Fix:** Added `_extract_json_list()`, which scans for the first `[` and
last `]` characters regardless of surrounding text. Applied the same
pattern to the expiration agent.

**Re-measured:** 0 parse failures across 20 subsequent manual test runs.

## Cycle 3 — Expiration escalation not verifiable (PR #24)

**Observed:** No way to confirm whether ambiguous items (kimchi, bone
broth, rendered duck fat) were being routed to the Sonnet subagent or
receiving confident Haiku estimates.

**Measured:** The expiration workflow's output contained no `model_used`
or `confidence` fields — the routing decision was made and discarded
internally.

**Diagnosed:** `estimate.get("confidence")` was used only for branching
logic inside `estimate_expirations` and never propagated to the enriched
output. The escalation path was untestable from outside the function.

**Fix:** Added `expiry_source` (`"haiku"`/`"sonnet"`) and
`expiry_confidence` (`"high"`/`"low"`/`None`) fields to every item returned
by the expiration workflow.

**Re-measured:** All three escalation test cases (`expiration.json` cases
19–21 in this eval suite — kimchi, bone broth, rendered duck fat) are now
verifiable by asserting `expiry_source == "sonnet"`.
