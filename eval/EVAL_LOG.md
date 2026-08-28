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

## Cycle 4 — Prompt hardening for Receipt Parsing and Expiration (PR #27)

**Observed:** The first automated harness run (PR #26, `run_20260824T055808Z.json`)
put two components well under the 70/100 pass threshold: Receipt Parsing
and Expiration.

**Measured:** Receipt Parsing 2/15 (13%). Expiration 13/26 (50%).

**Diagnosed:**

- Receipt Parsing — `api/agents/parser.py`'s extraction prompt never told
  Haiku how to handle count items, brand names, descriptive qualifiers, or
  multiplier/colloquial-unit lines, so it improvised: `unit: "each"` for
  eggs/avocados/bananas where fixtures expect `null` (10 of 13 failing
  cases), full brand names left in (`"Nandos Peri Peri Sauce"` instead of
  `"peri peri sauce"`), descriptive qualifiers kept, `"2 x greek yogurt
  500g"` returned as a single 500g line instead of two, and colloquial
  units (`dozen`, `half gallon`, `pound`, `pint`) passed through unconverted.
- Expiration — `api/agents/expiration.py`'s batch prompt had no concrete
  shelf-life guidance for several fixture items, so Haiku's estimates for
  raw chicken/fish/ground beef ran 3–5x longer than food-safety norms
  (case 1: 4 days vs. an expected 1–3; case 8: 5 days vs. 1–2; case 23: 3
  days vs. 1–2), opened coconut milk ran ~2x too long (case 15: 13 days vs.
  4–7), and rendered duck fat (case 21) came back `haiku`/`high` instead of
  escalating to the Sonnet subagent, despite being exactly the kind of
  unusual, low-information item the escalation path exists for. Separately,
  three fixtures were themselves miscalibrated against already-correct
  behavior: cases 11/12 (avocado ripe/unripe) and case 16 (red curry paste,
  opened jar) were being correctly escalated to Sonnet as ambiguous but the
  fixture still expected a confident Haiku answer, and case 22 (dry pasta)
  expected `max_days: 730` against a same-day-of-year-two-years-out date
  that lands one day past that boundary.

**Fix:**

- Added four explicit rules to `_EXTRACTION_INSTRUCTIONS` in
  `api/agents/parser.py`: (1) count items (eggs, avocados, onions, bananas,
  garlic bulbs, etc.) get `unit: null`, never `each`/`pieces`/`bunch`; (2)
  strip brand names to the generic product name; (3) strip descriptive
  qualifiers to the base ingredient name; (4) expand `N x <item> <qty><unit>`
  into `N` separate entries and convert colloquial units to metric
  (`dozen` → 12, `half gallon` → 1.89 L, `pound` → 453 g, `pint` → 568 mL).
- Added an explicit food-safety guideline block to `_BATCH_INSTRUCTIONS` in
  `api/agents/expiration.py`: fixed 1–2 day ranges for raw chicken/fish/
  ground beef, 4–7 days for opened coconut milk, 30–90 days for opened
  tahini, and an explicit instruction to report `confidence: "low"` for
  rendered animal fats (duck fat, lard, tallow) so the workflow's existing
  escalation branch runs.
- Recalibrated `eval/fixtures/expiration.json`: cases 11, 12, and 16 now
  expect `expected_source: "sonnet"` / `expected_confidence: "low"` (Haiku
  was escalating correctly; the fixture was wrong), and case 22's
  `max_days` moved from 730 to 731 (the fixture was off by one day).

**Re-measured:** Receipt Parsing 9/15 (60%), Expiration 19/26 (73%). Both
improved substantially but neither cleared the thresholds set for promoting
`latest.json` to `baseline.json` (80% / 75%), so `baseline.json` was **not**
updated this cycle.

Two findings worth flagging rather than quietly re-fixing, since chasing
them was outside this cycle's scope:

- Receipt Parsing's 6 remaining failures are new failure modes the four
  rules didn't anticipate, not the ones they targeted: `"1lb"` and `"4
  pints"` got converted to grams/litres even though rule 4's colloquial-unit
  examples (`pound of ground turkey`, `half gallon milk`) were meant for
  spelled-out colloquial phrases, not already-abbreviated units; rule 3's
  literal example (`organic baby spinach` → `spinach`) over-strips relative
  to what the fixture actually expects (`baby spinach`, only `organic`
  dropped), and the same over-stripping hit `fresh basil` → `basil`;
  `"water"` picked up a hallucinated `unit: "liter"`; and converted units
  came back as full words (`litre`, `gram`) instead of the abbreviated
  forms (`L`, `g`) the fixtures use, which the harness's case-insensitive
  string-equality unit check doesn't tolerate.
- Expiration's food-safety guidelines had a side effect beyond their
  targeted items: general model confidence on ambiguous items rose enough
  that cases 11, 12, and 16 (avocado ripe/unripe, red curry paste) flipped
  from escalating to a confident Haiku answer — undoing the exact
  escalation behavior this cycle's fixture recalibration just encoded — and
  case 20 (bone broth, homemade), which escalated correctly in the first
  run, regressed to a confident but out-of-scope Haiku answer. Cheddar
  cheese (case 7) and garlic (case 13) remain out of range and were never
  covered by the new guidance. Rendered duck fat (case 21) now escalates
  correctly but the Sonnet subagent's own date estimate is still 6x too
  long — `_SUBAGENT_INSTRUCTIONS` wasn't touched this cycle.
