"""CLI smoke test for `agents.pantry_deductor`.

Simulates cooking "Chickpea, chorizo & spinach stew" for the same test user
seeded by scripts/test_meal_recommender.py (chicken breast, spinach, eggs,
milk, greek yogurt), confirms the deduction plan matches spinach with high
confidence, applies it, and checks that the pantry and user_recipe_history
end up in the right state.

Not a pytest suite — a reproducible manual check that exercises the live
Supabase and Anthropic APIs. Requires ANTHROPIC_API_KEY, SUPABASE_URL, and
SUPABASE_SERVICE_KEY in the environment (see .env.example). Re-seeds the
test user's pantry itself (same fixture as test_meal_recommender.py), so it
can run standalone.

Usage:
    .venv/bin/python scripts/test_pantry_deduction.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from agents import pantry_deductor  # noqa: E402

TEST_USER_ID = "258f1143-4e2e-4f42-a389-bcd23c9696d9"
TEST_USER_EMAIL = "test-cli@mealmind.local"
RECIPE_TITLE = "Chickpea, chorizo & spinach stew"

# Mirrors scripts/test_meal_recommender.py's fixture data.
TEST_PANTRY_ITEMS = [
    ("chicken breast", 1, "kg", 2),
    ("spinach", 200, "g", 7),
    ("eggs", 12, "each", 21),
    ("milk", 2, "L", 7),
    ("greek yogurt", 500, "g", 14),
]

HIGH_CONFIDENCE_THRESHOLD = 0.7


def _seed_pantry() -> None:
    supabase = pantry_deductor._supabase()

    supabase.table("users").upsert(
        {
            "id": TEST_USER_ID,
            "email": TEST_USER_EMAIL,
            "cooking_skill": "intermediate",
            "dietary_restrictions": [],
            "max_cooking_time": 30,
        }
    ).execute()

    supabase.table("pantry_items").delete().eq("user_id", TEST_USER_ID).execute()

    today = date.today()
    rows = [
        {
            "user_id": TEST_USER_ID,
            "name": name,
            "quantity": quantity,
            "unit": unit,
            "purchase_date": today.isoformat(),
            "expiry_date": (today + timedelta(days=days_until_expiry)).isoformat(),
        }
        for name, quantity, unit, days_until_expiry in TEST_PANTRY_ITEMS
    ]
    supabase.table("pantry_items").insert(rows).execute()


def _find_recipe_id(title: str) -> str:
    result = (
        pantry_deductor._supabase()
        .table("recipes")
        .select("id, title")
        .ilike("title", f"%{title}%")
        .limit(1)
        .execute()
        .data
    )
    if not result:
        raise SystemExit(
            f"No seeded recipe found matching {title!r} — run database/seed_recipes.py first."
        )
    return result[0]["id"]


def main() -> None:
    _seed_pantry()
    recipe_id = _find_recipe_id(RECIPE_TITLE)
    print(f"Recipe: {RECIPE_TITLE} ({recipe_id})")

    plan = pantry_deductor.build_deduction_plan(recipe_id, TEST_USER_ID)
    print("\nDeduction plan:")
    for entry in plan:
        print(
            f"  - {entry['pantry_item_name']}: -{entry['quantity_to_deduct']} {entry['unit']} "
            f"(confidence {entry['confidence']:.2f})"
        )

    spinach_match = next(
        (e for e in plan if e["pantry_item_name"].strip().lower() == "spinach"), None
    )
    assert spinach_match is not None, "Expected the plan to include a match for spinach"
    assert spinach_match["confidence"] >= HIGH_CONFIDENCE_THRESHOLD, (
        f"Expected a high-confidence spinach match, got confidence={spinach_match['confidence']}"
    )
    print(f"\nPASS: spinach matched with confidence {spinach_match['confidence']:.2f}")

    updated_items = pantry_deductor.apply_deduction(TEST_USER_ID, recipe_id, plan)
    updated_spinach = next(
        (i for i in updated_items if i["id"] == spinach_match["pantry_item_id"]), None
    )
    assert updated_spinach is not None, "Expected the spinach pantry row to be updated"
    print(
        f"PASS: spinach deducted — quantity now {updated_spinach['quantity']}, "
        f"is_depleted={updated_spinach['is_depleted']}"
    )

    history = (
        pantry_deductor._supabase()
        .table("user_recipe_history")
        .select("cooked_at, confirmed_cooked")
        .eq("user_id", TEST_USER_ID)
        .eq("recipe_id", recipe_id)
        .order("viewed_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    assert history, "Expected a user_recipe_history row for this cook"
    assert history[0]["confirmed_cooked"] is True, "Expected confirmed_cooked to be true"
    assert history[0]["cooked_at"] is not None, "Expected cooked_at to be set"
    print(f"PASS: user_recipe_history confirmed_cooked=True, cooked_at={history[0]['cooked_at']}")

    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
