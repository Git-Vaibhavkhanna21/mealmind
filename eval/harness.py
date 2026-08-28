"""Runs every fixture in eval/fixtures/ against the real agents/workflows.

Five evaluators, one per component — three deterministic (exact/fuzzy match
against an expected value), two rubric-scored via eval/judge.py (there's no
single correct output for an open-ended recommendation or shopping list, see
the README's "Workflows vs. agents" section). `main()` runs all five,
writes eval/results/run_{timestamp}.json and eval/results/latest.json, and
prints nothing else — see eval/report.py for a human-readable summary.

Two things here deliberately don't match a literal reading of the PR 2 spec
this harness was built from, both because the literal reading can't work
against the actual code (checked, not guessed):

1. Expiration eval calls `api.workflows.expiration_workflow.estimate_expirations`
   (single-item list per case), not `api.agents.expiration.estimate_batch`
   directly. `estimate_batch` alone has no `expiry_source`/`expiry_confidence`
   fields and never calls the Sonnet subagent — those only exist on the
   *workflow*'s output (added in PR #24), which is the only function that can
   make the three Sonnet-escalation fixtures (kimchi, bone broth, rendered
   duck fat) pass at all.
2. Deduction eval needs Supabase credentials, not just ANTHROPIC_API_KEY.
   `api.agents.pantry_deductor.py` has no standalone "match one ingredient
   against a mock pantry" function — its only real function,
   `build_deduction_plan(recipe_id, user_id)`, always reads a recipe and a
   pantry from Supabase. To exercise it per-fixture with a controlled pantry,
   this harness seeds a throwaway single-ingredient recipe row and a scoped
   pantry in Supabase for each case, then deletes the recipe row (cascades to
   any history row) afterward.

Requires ANTHROPIC_API_KEY for all five evaluators; OPENAI_API_KEY and
SUPABASE_URL/SUPABASE_SERVICE_KEY for everything except receipt parsing and
expiration (see .env.example). Uses a dedicated eval user, kept separate
from the TEST_USER_ID scripts/test_*.py use, so this harness never clobbers
state those manual scripts depend on.

Usage:
    .venv/bin/python eval/harness.py
"""

from __future__ import annotations

import difflib
import json
import os
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

# eval/ sits at the repo root, same depth as scripts/ — identical pattern to
# scripts/test_*.py so `from api.agents import X` / `from api.workflows import Y`
# resolve the same way.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _REPO_ROOT)
# api/workflows/expiration_workflow.py itself does `from agents import
# expiration` (a bare, api/-relative import, since every api/agents/*.py file
# adds api/ itself to sys.path for its own `from mcp_servers import ...`
# imports) — none of scripts/test_*.py ever imports anything from
# api/workflows/, so they never need this second entry; this harness does.
sys.path.insert(0, os.path.join(_REPO_ROOT, "api"))
# Explicit rather than relying on Python's implicit script-directory
# sys.path[0] insertion, so `import judge` below resolves the same way
# whether this file is run directly or imported from elsewhere.
sys.path.insert(0, _EVAL_DIR)

from dotenv import load_dotenv  # noqa: E402
from supabase import Client, create_client  # noqa: E402

from api.agents import expiration, parser, pantry_deductor  # noqa: E402
from api.agents import meal_recommender, shopping_list  # noqa: E402
from api.workflows import expiration_workflow  # noqa: E402

import judge  # noqa: E402

load_dotenv()

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
RUBRICS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rubrics")
RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")

# 70/100 for every component, per eval/README.md. For the three deterministic
# components (no rubric score), pass_rate * 100 is compared against the same
# threshold, so all five components are judged on one consistent scale.
PASS_THRESHOLD = 70
NAME_SIMILARITY_THRESHOLD = 0.8

# A dedicated eval user, deliberately distinct from scripts/test_*.py's
# TEST_USER_ID, so this harness's repeated seed/reset cycles never clobber
# state those manual smoke tests depend on. Deterministic (uuid5, not
# uuid4) so re-running the harness always targets the same row.
EVAL_USER_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "eval-harness.mealmind.local"))
EVAL_USER_EMAIL = "eval-harness@mealmind.local"

_PANTRY_ITEM_STRING_PATTERN = re.compile(r"^(?P<name>.+?)\s+(?P<qty>\d+(?:\.\d+)?)(?P<unit>[a-zA-Z]*)$")

_supabase_client: Client | None = None


def _eval_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        )
    return _supabase_client


def _load_fixtures(filename: str) -> list[dict[str, Any]]:
    with open(os.path.join(FIXTURES_DIR, filename), "r", encoding="utf-8") as f:
        return json.load(f)


def _load_rubric(filename: str) -> str:
    with open(os.path.join(RUBRICS_DIR, filename), "r", encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Shared eval-user seeding helpers (recommendation, deduction, shopping list)
# ---------------------------------------------------------------------------


def _seed_eval_user(
    cooking_skill: str | None, dietary_restrictions: list[str], max_cooking_time: int | None
) -> None:
    _eval_supabase().table("users").upsert(
        {
            "id": EVAL_USER_ID,
            "email": EVAL_USER_EMAIL,
            "cooking_skill": cooking_skill,
            "dietary_restrictions": dietary_restrictions,
            "max_cooking_time": max_cooking_time,
        }
    ).execute()


def _reset_eval_pantry() -> None:
    _eval_supabase().table("pantry_items").delete().eq("user_id", EVAL_USER_ID).execute()


def _reset_eval_history() -> None:
    _eval_supabase().table("user_recipe_history").delete().eq("user_id", EVAL_USER_ID).execute()


def _pantry_row(
    name: str,
    quantity: float | int | None = 1,
    unit: str | None = None,
    days_until_expiry: int | None = None,
    is_depleted: bool = False,
) -> dict[str, Any]:
    today = date.today()
    expiry_date = (
        (today + timedelta(days=days_until_expiry)).isoformat()
        if days_until_expiry is not None
        else None
    )
    return {
        "user_id": EVAL_USER_ID,
        "name": name,
        "quantity": quantity,
        "unit": unit,
        "purchase_date": today.isoformat(),
        "expiry_date": expiry_date,
        "is_depleted": is_depleted,
    }


def _insert_pantry_rows(rows: list[dict[str, Any]]) -> None:
    if rows:
        _eval_supabase().table("pantry_items").insert(rows).execute()


def _create_eval_recipe(title: str, ingredients: list[str]) -> str:
    result = (
        _eval_supabase()
        .table("recipes")
        .insert({"title": title, "ingredients": ingredients})
        .execute()
        .data
    )
    return result[0]["id"]


def _delete_eval_recipe(recipe_id: str) -> None:
    # Cascades to any user_recipe_history row referencing it (see
    # database/migrations/0001_init.sql's `on delete cascade`).
    _eval_supabase().table("recipes").delete().eq("id", recipe_id).execute()


def _insert_confirmed_cook(recipe_id: str) -> None:
    _eval_supabase().table("user_recipe_history").insert(
        {
            "user_id": EVAL_USER_ID,
            "recipe_id": recipe_id,
            "cooked_at": datetime.now(timezone.utc).isoformat(),
            "confirmed_cooked": True,
        }
    ).execute()


def _weighted_totals(scores: dict[str, int], weights: dict[str, float]) -> tuple[float, float]:
    total = 0.0
    max_total = 0.0
    for criterion, score in scores.items():
        weight = weights.get(criterion, 1)
        total += score * weight
        max_total += 2 * weight
    return total, max_total


def _summarize(
    component: str, results: list[dict[str, Any]], score_key: str | None = None
) -> dict[str, Any]:
    total = len(results)
    passed_cases = sum(1 for r in results if r.get("passed"))
    pass_rate = passed_cases / total if total else 0.0

    if score_key is not None and results:
        avg_score = sum(r[score_key] for r in results if score_key in r) / total
        component_score = avg_score
    else:
        avg_score = None
        component_score = pass_rate * 100

    return {
        "component": component,
        "total_cases": total,
        "passed_cases": passed_cases,
        "pass_rate": pass_rate,
        "avg_score": avg_score,
        "component_score": component_score,
        "component_passed": component_score >= PASS_THRESHOLD,
        "cases": results,
    }


# ---------------------------------------------------------------------------
# 1. Receipt parsing (deterministic, ANTHROPIC_API_KEY only)
# ---------------------------------------------------------------------------


def _quantities_match(expected: Any, actual: Any) -> bool:
    if expected is None or actual is None:
        return expected == actual
    try:
        return abs(float(expected) - float(actual)) < 0.01
    except (TypeError, ValueError):
        return expected == actual


def _units_match(expected: Any, actual: Any) -> bool:
    if expected is None or actual is None:
        return expected == actual
    return str(expected).strip().lower() == str(actual).strip().lower()


def _items_match(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    similarity = difflib.SequenceMatcher(
        None, str(expected.get("name", "")).lower(), str(actual.get("name", "")).lower()
    ).ratio()
    if similarity <= NAME_SIMILARITY_THRESHOLD:
        return False
    if not _quantities_match(expected.get("quantity"), actual.get("quantity")):
        return False
    return _units_match(expected.get("unit"), actual.get("unit"))


def _precision_recall(
    expected_items: list[dict[str, Any]], actual_items: list[dict[str, Any]]
) -> tuple[float, float]:
    if not expected_items and not actual_items:
        return 1.0, 1.0

    remaining_actual = list(actual_items)
    matched = 0
    for expected in expected_items:
        match = next((a for a in remaining_actual if _items_match(expected, a)), None)
        if match is not None:
            remaining_actual.remove(match)
            matched += 1

    precision = matched / len(actual_items) if actual_items else (1.0 if not expected_items else 0.0)
    recall = matched / len(expected_items) if expected_items else (1.0 if not actual_items else 0.0)
    return precision, recall


def eval_receipt_parsing() -> dict[str, Any]:
    fixtures = _load_fixtures("receipt_parsing.json")
    results = []
    for case in fixtures:
        try:
            actual = parser.parse_receipt_text(case["input"])
            precision, recall = _precision_recall(case["expected_items"], actual)
            passed = precision >= 0.8 and recall >= 0.8
            results.append(
                {
                    "id": case["id"],
                    "input": case["input"],
                    "expected": case["expected_items"],
                    "actual": actual,
                    "item_precision": round(precision, 3),
                    "item_recall": round(recall, 3),
                    "passed": passed,
                }
            )
        except Exception as exc:  # a live API call — transient failures shouldn't sink the whole run
            results.append({"id": case["id"], "input": case["input"], "passed": False, "error": str(exc)})
    return _summarize("receipt_parsing", results)


# ---------------------------------------------------------------------------
# 2. Expiration (deterministic, ANTHROPIC_API_KEY only)
# ---------------------------------------------------------------------------


def eval_expiration() -> dict[str, Any]:
    fixtures = _load_fixtures("expiration.json")
    today = date.today()
    results = []
    for case in fixtures:
        try:
            enriched = expiration_workflow.estimate_expirations(
                [{"name": case["item_name"], "purchase_date": today.isoformat()}]
            )
            item = enriched[0]
            expiry_date_str = item.get("expiry_date")

            date_within_range = False
            if expiry_date_str:
                days = (date.fromisoformat(expiry_date_str) - today).days
                date_within_range = case["min_days"] <= days <= case["max_days"]

            source_matches = item.get("expiry_source") == case["expected_source"]
            confidence_matches = item.get("expiry_confidence") == case["expected_confidence"]
            passed = date_within_range and source_matches and confidence_matches

            results.append(
                {
                    "id": case["id"],
                    "item_name": case["item_name"],
                    "expiry_date": expiry_date_str,
                    "expiry_source": item.get("expiry_source"),
                    "expiry_confidence": item.get("expiry_confidence"),
                    "expected_source": case["expected_source"],
                    "expected_confidence": case["expected_confidence"],
                    "date_within_range": date_within_range,
                    "source_matches": source_matches,
                    "confidence_matches": confidence_matches,
                    "passed": passed,
                }
            )
        except Exception as exc:
            results.append({"id": case["id"], "item_name": case["item_name"], "passed": False, "error": str(exc)})
    return _summarize("expiration", results)


# ---------------------------------------------------------------------------
# 3. Recommendation (rubric-scored, needs ANTHROPIC/OPENAI/SUPABASE)
# ---------------------------------------------------------------------------


def eval_recommendation() -> dict[str, Any]:
    fixtures = _load_fixtures("recommendation.json")
    rubric_text = _load_rubric("recommendation.txt")
    results = []
    for case in fixtures:
        try:
            preferences = case["preferences"]
            _seed_eval_user(
                preferences.get("cooking_skill"),
                preferences.get("dietary_restrictions", []),
                preferences.get("max_cooking_time_minutes"),
            )
            _reset_eval_pantry()
            _insert_pantry_rows(
                [
                    _pantry_row(item["name"], days_until_expiry=item["days_until_expiry"])
                    for item in case["pantry"]
                ]
            )

            recipes = meal_recommender.recommend(EVAL_USER_ID)

            judgment = judge.judge_output(
                "meal recommendation",
                {"pantry": case["pantry"], "preferences": preferences},
                recipes,
                rubric_text,
            )
            scores = judgment.get("scores", {})
            reasoning = judgment.get("reasoning", {})
            weights = case.get("rubric_weights") or {k: 1 for k in scores}
            total, max_total = _weighted_totals(scores, weights)
            normalised = (total / max_total * 100) if max_total else 0.0

            results.append(
                {
                    "id": case["id"],
                    "output": recipes,
                    "scores": scores,
                    "reasoning": reasoning,
                    "total_score": total,
                    "max_score": max_total,
                    "normalised_score_0_to_100": round(normalised, 1),
                    "passed": normalised >= PASS_THRESHOLD,
                }
            )
        except Exception as exc:
            results.append({"id": case["id"], "passed": False, "error": str(exc)})
    return _summarize("recommendation", results, score_key="normalised_score_0_to_100")


# ---------------------------------------------------------------------------
# 4. Deduction (deterministic, needs ANTHROPIC + SUPABASE — see module
#    docstring point 2 for why Supabase is unavoidable here)
# ---------------------------------------------------------------------------


def _parse_pantry_item_string(text: str) -> dict[str, Any]:
    """"spinach 200g" -> {name: "spinach", quantity: 200, unit: "g"};
    falls back to quantity=1/unit=None for strings with no trailing
    number (e.g. "fresh coriander bunch")."""
    match = _PANTRY_ITEM_STRING_PATTERN.match(text.strip())
    if not match:
        return {"name": text.strip(), "quantity": 1, "unit": None}
    return {
        "name": match.group("name").strip(),
        "quantity": float(match.group("qty")),
        "unit": match.group("unit") or None,
    }


def eval_deduction() -> dict[str, Any]:
    fixtures = _load_fixtures("deduction.json")
    results = []
    for case in fixtures:
        recipe_id = None
        try:
            _seed_eval_user("intermediate", [], 30)
            _reset_eval_pantry()
            if case["pantry_item"] is not None:
                parsed = _parse_pantry_item_string(case["pantry_item"])
                _insert_pantry_rows(
                    [
                        _pantry_row(
                            parsed["name"],
                            quantity=parsed["quantity"],
                            unit=parsed["unit"],
                            days_until_expiry=7,
                        )
                    ]
                )

            recipe_id = _create_eval_recipe(
                f"[eval-deduction case {case['id']}]", [case["recipe_ingredient"]]
            )
            plan = pantry_deductor.build_deduction_plan(recipe_id, EVAL_USER_ID)

            actual_match = any(entry.get("match_found") for entry in plan)
            results.append(
                {
                    "id": case["id"],
                    "recipe_ingredient": case["recipe_ingredient"],
                    "pantry_item": case["pantry_item"],
                    "expected_match": case["expected_match"],
                    "actual_match": actual_match,
                    "plan": plan,
                    "passed": actual_match == case["expected_match"],
                }
            )
        except Exception as exc:
            results.append(
                {
                    "id": case["id"],
                    "recipe_ingredient": case["recipe_ingredient"],
                    "pantry_item": case["pantry_item"],
                    "passed": False,
                    "error": str(exc),
                }
            )
        finally:
            if recipe_id is not None:
                _delete_eval_recipe(recipe_id)
    return _summarize("deduction", results)


# ---------------------------------------------------------------------------
# 5. Shopping list (rubric-scored, needs ANTHROPIC + SUPABASE)
# ---------------------------------------------------------------------------


def eval_shopping_list() -> dict[str, Any]:
    fixtures = _load_fixtures("shopping_list.json")
    rubric_text = _load_rubric("shopping_list.txt")
    results = []
    for case in fixtures:
        recipe_ids: list[str] = []
        try:
            preferences = case["preferences"]
            _seed_eval_user(
                preferences.get("cooking_skill"),
                preferences.get("dietary_restrictions", []),
                preferences.get("max_cooking_time_minutes"),
            )
            _reset_eval_pantry()
            _insert_pantry_rows(
                [
                    _pantry_row(
                        item["name"],
                        quantity=item.get("quantity"),
                        unit=item.get("unit"),
                        is_depleted=item.get("is_depleted", False),
                    )
                    for item in case["pantry"]
                ]
            )
            _reset_eval_history()
            for entry in case["recent_history"]:
                recipe_id = _create_eval_recipe(entry["recipe_name"], entry["ingredients_used"])
                recipe_ids.append(recipe_id)
                _insert_confirmed_cook(recipe_id)

            items = shopping_list.generate_shopping_list(EVAL_USER_ID)

            judgment = judge.judge_output(
                "shopping list",
                {
                    "pantry": case["pantry"],
                    "recent_history": case["recent_history"],
                    "preferences": preferences,
                },
                items,
                rubric_text,
            )
            scores = judgment.get("scores", {})
            reasoning = judgment.get("reasoning", {})
            weights = case.get("rubric_weights") or {k: 1 for k in scores}
            total, max_total = _weighted_totals(scores, weights)
            normalised = (total / max_total * 100) if max_total else 0.0

            results.append(
                {
                    "id": case["id"],
                    "output": items,
                    "scores": scores,
                    "reasoning": reasoning,
                    "total_score": total,
                    "max_score": max_total,
                    "normalised_score_0_to_100": round(normalised, 1),
                    "passed": normalised >= PASS_THRESHOLD,
                }
            )
        except Exception as exc:
            results.append({"id": case["id"], "passed": False, "error": str(exc)})
        finally:
            for recipe_id in recipe_ids:
                _delete_eval_recipe(recipe_id)
    return _summarize("shopping_list", results, score_key="normalised_score_0_to_100")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    os.makedirs(RESULTS_DIR, exist_ok=True)

    print("Running receipt parsing eval...")
    receipt_parsing_result = eval_receipt_parsing()
    print("Running expiration eval...")
    expiration_result = eval_expiration()
    print("Running recommendation eval...")
    recommendation_result = eval_recommendation()
    print("Running deduction eval...")
    deduction_result = eval_deduction()
    print("Running shopping list eval...")
    shopping_list_result = eval_shopping_list()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "timestamp": timestamp,
        "components": {
            "receipt_parsing": receipt_parsing_result,
            "expiration": expiration_result,
            "recommendation": recommendation_result,
            "deduction": deduction_result,
            "shopping_list": shopping_list_result,
        },
    }

    run_path = os.path.join(RESULTS_DIR, f"run_{timestamp}.json")
    latest_path = os.path.join(RESULTS_DIR, "latest.json")
    for path in (run_path, latest_path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, default=str)

    print(f"\nWrote {run_path}")
    print(f"Wrote {latest_path}")


if __name__ == "__main__":
    main()
