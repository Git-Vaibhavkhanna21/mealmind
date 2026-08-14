"""Workflow: scan pantry for expiring items and notify/recommend meals.

`estimate_expirations` is the deterministic piece of that pipeline used
right after receipt parsing: it always calls the Haiku batch estimator
first, then branches — call the Sonnet subagent, or don't — purely on
whether Haiku reported "low" confidence for a given item. That branching
condition is a fixed rule, not a judgment call, which is why it lives here
in the workflow rather than in `api/agents/expiration.py` itself (see
"Workflows vs. agents" in the README).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from agents import expiration


def estimate_expirations(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach an `expiry_date` to each item, escalating low-confidence ones.

    Every item is estimated in a single Haiku batch call first. Any item
    that comes back with "low" confidence (or fails to parse at all) gets a
    follow-up Sonnet subagent call to reason through it individually, so the
    workflow always terminates with a best-effort date rather than leaving
    items unestimated.
    """
    if not items:
        return []

    today = date.today().isoformat()
    estimates = expiration.estimate_batch(items, today)
    estimates_by_name = {e["name"]: e for e in estimates}

    enriched: list[dict[str, Any]] = []
    for item in items:
        estimate = estimates_by_name.get(item["name"])
        if estimate is not None and estimate.get("confidence") == "high" and estimate.get("expiry_date"):
            expiry_date = estimate["expiry_date"]
        else:
            subagent_result = expiration.estimate_with_subagent(item, today)
            expiry_date = subagent_result.get("expiry_date")

        enriched.append({**item, "expiry_date": expiry_date})

    return enriched


def run() -> dict:
    raise NotImplementedError
