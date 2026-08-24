# MealMind Eval Harness

Evaluation fixtures, rubrics, and testing history for MealMind's agents and
workflows — receipt parsing, expiration estimation, meal recommendation,
cook confirmation/pantry deduction, and shopping list generation.

## What this is

A structured way to answer "did this change make the agents better or
worse?" instead of relying on spot-checking output by hand. Deterministic
components (receipt parsing, expiration estimation, pantry deduction) are
checked against fixed expected values. Open-ended, judgment-based
components (meal recommendation, shopping list generation) are scored
against a rubric, since there's no single "correct" ranked recipe list to
diff against.

## Two eval loops

1. **Manual (`EVAL_LOG.md`, this PR)** — the informal process used so far:
   notice a problem during manual testing, measure it concretely, diagnose
   the root cause, fix it, and re-measure to confirm. Three cycles from the
   build so far are documented there. This isn't automated and isn't
   repeatable on demand — it's a historical record.
2. **Automated (PR 2)** — a Python harness that runs every fixture in
   `fixtures/` against the real agents/workflows, scores the deterministic
   ones against their expected values and the judgment-based ones against
   the rubrics in `rubrics/` (via an LLM-as-judge call), and reports a
   pass/fail score per component. This is what turns the manual process
   above into something that runs the same way every time and catches
   regressions automatically.

## How scoring works

- **Deterministic components** (receipt parsing, expiration, deduction):
  each fixture either matches its expected output or it doesn't. A
  component's score is the percentage of its fixtures that passed.
- **Judgment-based components** (recommendation, shopping list): each
  fixture is scored against every criterion in that component's rubric on
  a 0–2 scale (0 = fail, 1 = partial, 2 = pass). A fixture's score is the
  sum of its criterion scores normalized to 0–100
  (`sum / (criteria_count * 2) * 100`). A component's score is the average
  of its fixtures' normalized scores.

Recommendation criteria can be weighted unevenly via each fixture's
`rubric_weights` (all six are weighted equally for now — see
`fixtures/recommendation.json`) — the normalization above generalizes to
`sum(score * weight) / sum(max_score * weight) * 100` once weights differ.

## Pass threshold

**70/100** for every component. A component below 70 is a regression,
regardless of whether other components improved.

## Running the harness

Not yet — the harness itself lands in PR 2. This PR is fixtures, rubrics,
and the manual eval log only.

## Baseline / regression flow

Once the harness exists (PR 2): run it against `main` before making a
change to establish a baseline score per component, make the change, run
it again, and compare. A change that drops any component below the 70/100
threshold, or drops a previously-passing component's score meaningfully
even if it stays above threshold, should be treated the same way a manual
`EVAL_LOG.md` cycle treats a regression — diagnosed and fixed before the
change ships, not shipped and revisited later.
