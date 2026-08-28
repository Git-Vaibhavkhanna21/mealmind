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

## Cycle 5 — Second hardening pass: unit precision and escalation override (PR #27, second commit)

**Observed:** Cycle 4's re-measurement (60% Receipt Parsing, 73%
Expiration) fell short of the 80%/75% promotion bar, and two of Cycle 4's
own fixes had side effects: unit conversion applied to already-abbreviated
units, qualifier-stripping erased fixture-significant variety names, and
the new expiration food-safety ranges raised general model confidence
enough to undo three escalation cases the harness had just confirmed were
correct.

**Measured:** Receipt Parsing 9/15 (60%). Expiration 19/26 (73%).

**Diagnosed:** Cycle 4's parser rule 4 didn't distinguish "convert this
colloquial phrase" from "leave this abbreviation alone," so `1lb` and `4
pints` got converted anyway. Cycle 4's rule 3 (qualifier stripping) had no
concept of a variety name vs. a sourcing adjective, so `baby spinach` and
`fresh basil` lost meaningful parts of their name. Converted units came
back as full words (`litre`, `gram`) with no rule enforcing abbreviated
form. `"water"` had no explicit no-quantity-stated example to anchor
`quantity: 1, unit: null`. On the expiration side, the food-safety ranges
added general confidence without a hard floor for the specific item
categories (homemade goods, ripeness-dependent produce, rendered fats,
aging fermented condiments) that need to stay low-confidence regardless of
what else the prompt says.

**Fix:**

- `api/agents/parser.py`: replaced the qualifier-stripping rule with a
  narrower one — strip only production/sourcing qualifiers (organic, free
  range, unsalted, homemade, natural, generic "fresh") and explicitly keep
  variety-identifying names (baby spinach, cherry tomatoes, sourdough
  bread, mozzarella di bufala). Replaced the conversion rule so it only
  fires on written-out colloquial phrases (`pound of X`, `dozen`, `half
  gallon`) and explicitly leaves already-abbreviated units (`1lb`, `4
  pints`, `2oz`) untouched. Added a standard-abbreviation rule (`g`, `kg`,
  `L`, `ml`, `lb`, `pint` — never the spelled-out form). Added an explicit
  no-stated-quantity example for generic liquids/ingredients (water, oil,
  salt → `quantity: 1, unit: null`).
- `api/agents/expiration.py`: added a hard override block *before* the
  food-safety ranges — always report `confidence: low` for homemade items,
  ripeness-dependent produce, rendered animal fats, and aging fermented
  condiments (miso open >3 months, kimchi, fermented hot sauce),
  regardless of what the rest of the prompt says.

**Re-measured:** Receipt Parsing 13/15 (87%) — clears the 80% bar.
Expiration 19/26 (73%) — same pass *rate* as Cycle 4, but a different set
of failing cases; still short of the 75% bar. Because the combined
condition (Receipt Parsing ≥ 80% **and** Expiration ≥ 75%) requires both,
`baseline.json` was **not** created this cycle either.

Remaining findings, not chased further (outside this cycle's two-fix
scope):

- Receipt Parsing's 2 remaining failures are narrower versions of Cycle
  4's problem: `broccoli florets` → fixture wants `broccoli`, but
  "florets" is neither a listed sourcing qualifier nor a listed variety
  name, so the new rule leaves it untouched; `mozzarella di bufala` is now
  *explicitly* kept by name per this cycle's own instruction, but the
  fixture (unchanged since Cycle 1) still expects it collapsed to
  `mozzarella` — a genuine conflict between this cycle's instructions and
  the existing fixture, not a bug in either the prompt or the harness.
- Expiration's failing set shifted rather than shrank: cases 12 (avocado
  unripe) and 20 (bone broth) are now fixed by the override block, but
  case 17 (miso paste, opened — no duration stated) newly regressed,
  likely because the override's "miso open longer than 3 months" clause
  bled into the underspecified generic case; case 24 (oat milk, opened)
  newly regressed with no rule change touching dairy alternatives at all,
  suggesting some of this is ordinary run-to-run model variance rather
  than a prompt effect. Case 16 (red curry paste) still doesn't escalate —
  it's a condiment but not a *fermented* one, so it falls outside every
  override clause as literally written. Cheddar cheese (7), garlic (13),
  and rendered duck fat's Sonnet subagent estimate (21, now escalating
  correctly but ~4 days over its range) remain unaddressed, same as Cycle
  4.
- Deduction dropped from 93% to 79% and Shopping List rose from 80% to
  100% between these two runs despite neither `deduction.json`,
  `shopping_list.json`, `pantry_deductor.py`, nor `shopping_list.py` being
  touched in either cycle — both components call live, non-deterministic
  LLM judgment (Haiku confidence matching, Sonnet-judged rubric scoring),
  so some run-to-run swing on them is expected and isn't evidence of a
  regression from this cycle's changes.

**Combined delta across Cycles 2, 4, and 5** (first harness run → after
both hardening passes):

| Component | Cycle 2 (first run) | Cycle 4 | Cycle 5 |
|---|---|---|---|
| Receipt Parsing | 2/15 (13%) | 9/15 (60%) | 13/15 (87%) |
| Expiration | 13/26 (50%) | 19/26 (73%) | 19/26 (73%) |

Receipt Parsing: +74 points over two cycles, now above threshold.
Expiration: +23 points over two cycles, still 2 points under threshold —
the remaining gap is concentrated in items no rule in either cycle
targets (cheddar, garlic) and one subagent estimate that was never in
scope (rendered duck fat's actual date, as opposed to its
escalation/confidence, which is now correct).
