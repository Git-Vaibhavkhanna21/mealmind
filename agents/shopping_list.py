"""Generates a shopping list from pantry state, cook history, and preferences.

Deciding what a user should buy next isn't set arithmetic against a fixed
meal plan — it's an open-ended judgment call that weighs three different
kinds of signal at once: what's running low, what would round out items
already on hand into a full dish, and what would let the user re-cook
something they've made before. That's exactly the shape of problem handed
to Sonnet elsewhere in this codebase (see `agents/meal_recommender.py`), so
the whole suggestion step — not just ingredient-name reconciliation — is
delegated to Sonnet here too, rather than Haiku doing lightweight matching
against a caller-supplied meal plan.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anthropic import Anthropic  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from supabase import Client, create_client  # noqa: E402

from mcp_servers import pantry_inventory  # noqa: E402

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 3072
HISTORY_LIMIT = 10

_SHOPPING_LIST_INSTRUCTIONS = """\
You are building a grocery shopping list for a home cook based on their
current pantry, what they've cooked recently, and their preferences.

User preferences: {preferences_text}

Current pantry (non-depleted items):
{pantry_json}

Recently cooked recipes (most recent first, with their ingredient lists):
{history_json}

Suggest items to add to the shopping list. Each suggestion should do one of
the following:
- replenish a pantry item that's running low or already depleted
- complement what's already in the pantry (an ingredient that would round
  out several items already on hand into a full recipe)
- enable a dish they've cooked before whose ingredients aren't fully in
  stock right now

Respect their dietary restrictions — never suggest an item that conflicts
with one.

Respond with ONLY a JSON array of objects, each with exactly the keys
"name", "quantity" (number), "unit" (string), and "rationale" — a single
sentence explaining why this item is suggested (replenishing, complementing
what's on hand, or enabling a specific past dish by name). No prose, no
markdown code fences.
"""

_supabase_client: Client | None = None


def _supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        )
    return _supabase_client


def _anthropic() -> Anthropic:
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def get_pantry_state(user_id: str) -> list[dict[str, Any]]:
    """Non-depleted pantry items, via the pantry MCP server."""
    return pantry_inventory.list_items(user_id)


def get_recent_cooked_history(user_id: str, limit: int = HISTORY_LIMIT) -> list[dict[str, Any]]:
    """The user's last `limit` confirmed cooks, most recent first, each with
    the recipe's title and ingredient list."""
    rows = (
        _supabase()
        .table("user_recipe_history")
        .select("cooked_at, recipes(title, ingredients)")
        .eq("user_id", user_id)
        .eq("confirmed_cooked", True)
        .order("cooked_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [
        {"title": row["recipes"]["title"], "ingredients": row["recipes"]["ingredients"]}
        for row in rows
        if row.get("recipes")
    ]


def get_preferences(user_id: str) -> dict[str, Any]:
    return (
        _supabase()
        .table("users")
        .select("cooking_skill, dietary_restrictions")
        .eq("id", user_id)
        .single()
        .execute()
        .data
    )


def _preferences_text(preferences: dict[str, Any]) -> str:
    clauses = []
    if preferences.get("cooking_skill"):
        clauses.append(f"{preferences['cooking_skill']} cooking skill")
    restrictions = preferences.get("dietary_restrictions") or []
    if restrictions:
        clauses.append(", ".join(f"no {r}" for r in restrictions))
    return ", ".join(clauses) if clauses else "no stated preferences"


def _extract_json_list(response_text: str) -> list[dict[str, Any]]:
    """Pull the `[...]` array out of a response, tolerating stray prose —
    same tolerant-parsing approach as agents/meal_recommender.py and
    agents/pantry_deductor.py, since Sonnet occasionally prefaces JSON
    output with a sentence of explanation despite "no prose" instructions.
    """
    text = response_text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON array found in response: {text!r}")

    items = json.loads(text[start : end + 1])
    if not isinstance(items, list):
        raise ValueError(f"Expected a JSON array of shopping list items, got: {type(items)}")
    return items


def _save_shopping_list(user_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace the user's unpurchased shopping list items with a new batch.

    Purchased items are left alone — they're history, not the open list.
    """
    supabase = _supabase()
    supabase.table("shopping_list_items").delete().eq("user_id", user_id).eq(
        "purchased", False
    ).execute()

    if not items:
        return []

    rows = [
        {
            "user_id": user_id,
            "name": item["name"],
            "quantity": item.get("quantity"),
            "unit": item.get("unit"),
            "rationale": item.get("rationale"),
        }
        for item in items
    ]
    return supabase.table("shopping_list_items").insert(rows).execute().data


def generate_shopping_list(user_id: str) -> list[dict[str, Any]]:
    """Generate a shopping list from pantry state, cook history, and
    preferences, and persist it as the user's new open shopping list."""
    pantry_items = get_pantry_state(user_id)
    history = get_recent_cooked_history(user_id)
    preferences = get_preferences(user_id)

    prompt = _SHOPPING_LIST_INSTRUCTIONS.format(
        preferences_text=_preferences_text(preferences),
        pantry_json=json.dumps(
            [
                {
                    "name": item["name"],
                    "quantity": item.get("quantity"),
                    "unit": item.get("unit"),
                    "expiry_date": item.get("expiry_date"),
                }
                for item in pantry_items
            ]
        ),
        history_json=json.dumps(history),
    )

    response = _anthropic().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, messages=[{"role": "user", "content": prompt}]
    )
    response_text = "".join(block.text for block in response.content if block.type == "text")
    items = _extract_json_list(response_text)

    return _save_shopping_list(user_id, items)


def _cli() -> None:
    load_dotenv()

    arg_parser = argparse.ArgumentParser(description="Generate a shopping list for a user.")
    arg_parser.add_argument("--user-id", required=True)
    args = arg_parser.parse_args()

    items = generate_shopping_list(args.user_id)
    print(json.dumps({"items": items}, default=str))


if __name__ == "__main__":
    _cli()
