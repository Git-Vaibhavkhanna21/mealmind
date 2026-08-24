"""Compares eval/results/baseline.json against eval/results/latest.json and
flags regressions.

Doesn't run any agents itself — run eval/harness.py first to produce
latest.json, and see eval/README.md's "Baseline / regression flow" for when
to promote a latest.json to baseline.json. This PR intentionally doesn't
create baseline.json; that happens on the first real run this repo commits
to as its known-good reference point.

Usage:
    .venv/bin/python eval/regression.py
"""

from __future__ import annotations

import json
import os
import sys

RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
BASELINE_PATH = os.path.join(RESULTS_DIR, "baseline.json")
LATEST_PATH = os.path.join(RESULTS_DIR, "latest.json")

# Percentage points (pass rate) / points on the 0-100 scale (avg score).
PASS_RATE_DROP_THRESHOLD = 5
SCORE_DROP_THRESHOLD = 5

COMPONENT_ORDER = ["receipt_parsing", "expiration", "recommendation", "deduction", "shopping_list"]
COMPONENT_LABELS = {
    "receipt_parsing": "Receipt Parsing",
    "expiration": "Expiration",
    "recommendation": "Recommendation",
    "deduction": "Deduction",
    "shopping_list": "Shopping List",
}


def _load(path: str) -> dict:
    if not os.path.exists(path):
        raise SystemExit(f"{path} not found — run eval/harness.py to produce it first.")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    baseline = _load(BASELINE_PATH)
    latest = _load(LATEST_PATH)

    regressions = []
    for key in COMPONENT_ORDER:
        base = baseline["components"][key]
        current = latest["components"][key]

        pass_rate_drop = (base["pass_rate"] - current["pass_rate"]) * 100
        if pass_rate_drop > PASS_RATE_DROP_THRESHOLD:
            regressions.append(
                f"{COMPONENT_LABELS[key]}: pass rate dropped {pass_rate_drop:.1f} points "
                f"({base['pass_rate'] * 100:.0f}% -> {current['pass_rate'] * 100:.0f}%)"
            )

        if base["avg_score"] is not None and current["avg_score"] is not None:
            score_drop = base["avg_score"] - current["avg_score"]
            if score_drop > SCORE_DROP_THRESHOLD:
                regressions.append(
                    f"{COMPONENT_LABELS[key]}: avg score dropped {score_drop:.1f} points "
                    f"({base['avg_score']:.0f} -> {current['avg_score']:.0f})"
                )

    print("MEALMIND REGRESSION CHECK")
    print(f"Baseline: {baseline['timestamp']}")
    print(f"Latest:   {latest['timestamp']}\n")

    if regressions:
        print("REGRESSION DETECTED\n")
        for line in regressions:
            print(f"  - {line}")
        sys.exit(1)

    print("ALL CLEAR — no component regressed beyond threshold.")


if __name__ == "__main__":
    main()
