"""CLI smoke test for `agents.meal_recommender.recommend`.

Seeds a fixed test user's pantry with the same items used to verify the
receipt parsing workflow (chicken breast, spinach, eggs, milk, greek
yogurt), sets cooking_skill=intermediate / no dietary restrictions /
max_cooking_time=30, then runs the real recommendation pipeline end to end
against Supabase, OpenAI, and Anthropic and prints the 3 recommendations.

Not a pytest suite — a reproducible manual check that exercises the live
APIs. Requires ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL, and
SUPABASE_SERVICE_KEY in the environment (see .env.example).

Usage:
    .venv/bin/python scripts/test_meal_recommender.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from api.agents import meal_recommender  # noqa: E402

TEST_USER_ID = "258f1143-4e2e-4f42-a389-bcd23c9696d9"
TEST_USER_EMAIL = "test-cli@mealmind.local"

# (name, quantity, unit, days_until_expiry) — mirrors the pantry seeded
# while testing workflows/receipt_parsing.py.
TEST_PANTRY_ITEMS = [
    ("chicken breast", 1, "kg", 2),
    ("spinach", 200, "g", 7),
    ("eggs", 12, "each", 21),
    ("milk", 2, "L", 7),
    ("greek yogurt", 500, "g", 14),
]


def _seed() -> None:
    """Reset the test user's profile and pantry to a known state."""
    supabase = meal_recommender._supabase()

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


def main() -> None:
    _seed()
    recipes = meal_recommender.recommend(TEST_USER_ID)

    print(f"\n{len(recipes)} recommendation(s) for {TEST_USER_EMAIL}:\n")
    for recipe in recipes:
        print(f"- {recipe['title']} (~{recipe['prep_time_minutes']} min)")
        print(f"  uses: {', '.join(recipe['pantry_items_used']) or 'none'}")
        print(f"  why: {recipe['reason']}\n")


if __name__ == "__main__":
    main()
