"""Human-readable summary of the most recent eval run.

Reads eval/results/latest.json (written by eval/harness.py) and prints a
per-component pass-rate/score table plus a breakdown of the lowest-scoring
component's failing cases. Doesn't run any agents itself.

Usage:
    .venv/bin/python eval/report.py
"""

from __future__ import annotations

import json
import os

RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
LATEST_PATH = os.path.join(RESULTS_DIR, "latest.json")

COMPONENT_ORDER = ["receipt_parsing", "expiration", "recommendation", "deduction", "shopping_list"]
COMPONENT_LABELS = {
    "receipt_parsing": "Receipt Parsing",
    "expiration": "Expiration",
    "recommendation": "Recommendation",
    "deduction": "Deduction",
    "shopping_list": "Shopping List",
}


def _load_latest() -> dict:
    if not os.path.exists(LATEST_PATH):
        raise SystemExit(f"{LATEST_PATH} not found — run eval/harness.py first.")
    with open(LATEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _pass_rate_cell(component: dict) -> str:
    return f"{component['passed_cases']}/{component['total_cases']} ({round(component['pass_rate'] * 100)}%)"


def _avg_score_cell(component: dict) -> str:
    if component["avg_score"] is None:
        return "n/a"
    return f"{round(component['avg_score'])}/100"


def _status_cell(component: dict) -> str:
    return "✓ PASS" if component["component_passed"] else "✗ FAIL"


def _case_failure_line(component_key: str, case: dict) -> str:
    if "error" in case:
        return f"  Case {case['id']}: error — {case['error']}"

    if component_key == "receipt_parsing":
        return f"  Case {case['id']}: precision={case['item_precision']:.2f}, recall={case['item_recall']:.2f}"

    if component_key == "expiration":
        reasons = []
        if not case["date_within_range"]:
            reasons.append(f"expiry_date {case['expiry_date']}, outside expected range")
        if not case["source_matches"]:
            reasons.append(f"expiry_source={case['expiry_source']}, expected={case['expected_source']}")
        if not case["confidence_matches"]:
            reasons.append(
                f"expiry_confidence={case['expiry_confidence']}, expected={case['expected_confidence']}"
            )
        return f"  Case {case['id']} ({case['item_name']}): " + "; ".join(reasons)

    if component_key == "deduction":
        return (
            f"  Case {case['id']} ({case['recipe_ingredient']}): "
            f"actual_match={case['actual_match']}, expected={case['expected_match']}"
        )

    if component_key in ("recommendation", "shopping_list"):
        low_criteria = {k: v for k, v in case.get("scores", {}).items() if v < 2}
        return f"  Case {case['id']}: score={case.get('normalised_score_0_to_100')}/100, low criteria={low_criteria}"

    return f"  Case {case['id']}: failed"


def main() -> None:
    report = _load_latest()
    components = report["components"]

    print("MEALMIND EVALUATION REPORT")
    print(f"Run: {report['timestamp']}\n")

    print(f"{'COMPONENT':<18} {'PASS RATE':<14} {'AVG SCORE':<12} STATUS")
    for key in COMPONENT_ORDER:
        component = components[key]
        print(
            f"{COMPONENT_LABELS[key]:<18} {_pass_rate_cell(component):<14} "
            f"{_avg_score_cell(component):<12} {_status_cell(component)}"
        )

    passing = sum(1 for key in COMPONENT_ORDER if components[key]["component_passed"])
    print(f"\nOVERALL: {passing}/{len(COMPONENT_ORDER)} components passing")

    lowest_key = min(COMPONENT_ORDER, key=lambda k: components[k]["component_score"])
    lowest = components[lowest_key]
    failing_cases = [c for c in lowest["cases"] if not c.get("passed")]

    print(
        f"\nLOWEST SCORER: {COMPONENT_LABELS[lowest_key]} — "
        f"{len(failing_cases)} case{'s' if len(failing_cases) != 1 else ''} failing"
    )
    for case in failing_cases:
        print(_case_failure_line(lowest_key, case))


if __name__ == "__main__":
    main()
