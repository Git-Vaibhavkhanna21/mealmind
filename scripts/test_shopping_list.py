"""CLI smoke test for `agents.shopping_list.generate_shopping_list`.

Runs against the existing test user's live pantry and recipe history — the
same TEST_USER_ID used by scripts/test_meal_recommender.py and
scripts/test_pantry_deduction.py — with no re-seeding, so this exercises
whatever real state that user has actually accumulated (including whatever
those two scripts left behind). Prints the pantry, recent cook history, and
the generated shopping list with rationales.

Not a pytest suite — a reproducible manual check that exercises the live
Supabase and Anthropic APIs. Requires ANTHROPIC_API_KEY, SUPABASE_URL, and
SUPABASE_SERVICE_KEY in the environment (see .env.example).

Usage:
    .venv/bin/python scripts/test_shopping_list.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from api.agents import shopping_list  # noqa: E402

TEST_USER_ID = "258f1143-4e2e-4f42-a389-bcd23c9696d9"


def main() -> None:
    pantry = shopping_list.get_pantry_state(TEST_USER_ID)
    print(f"Pantry ({len(pantry)} non-depleted items):")
    for item in pantry:
        print(f"  - {item['name']}: {item.get('quantity')} {item.get('unit') or ''}".rstrip())

    history = shopping_list.get_recent_cooked_history(TEST_USER_ID)
    print(f"\nRecent cooked history ({len(history)} recipes):")
    for entry in history:
        print(f"  - {entry['title']}")

    items = shopping_list.generate_shopping_list(TEST_USER_ID)
    print(f"\nShopping list ({len(items)} items):\n")
    for item in items:
        quantity = f"{item.get('quantity')} {item.get('unit') or ''}".strip()
        print(f"  - {item['name']} ({quantity})")
        print(f"    {item.get('rationale')}\n")


if __name__ == "__main__":
    main()
