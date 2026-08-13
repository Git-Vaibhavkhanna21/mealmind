"""Matches a cooked recipe's ingredients against pantry stock and deducts it.

Recipe ingredient names never exactly match pantry item names ("fresh
spinach" vs. "spinach", "large eggs" vs. "eggs") — reconciling the two
needs semantic judgment, not string matching, so that step is delegated to
Claude Haiku (fast/cheap fits the task: one bounded matching call per cook
confirmation, not open-ended reasoning). Haiku also reports a confidence
score per match so the frontend can flag shaky matches for the user to
review before anything is deducted, rather than silently auto-deducting a
wrong item.

`build_deduction_plan` is the judgment step (Haiku). `apply_deduction` is
the deterministic execution step once the user has confirmed the plan —
subtract quantities, flip `is_depleted`, record the cook in
`user_recipe_history` — no model call involved.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anthropic import Anthropic  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from supabase import Client, create_client  # noqa: E402

from mcp_servers import pantry_inventory  # noqa: E402

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 2048

_DEDUCTION_INSTRUCTIONS = """\
You are matching recipe ingredients to a user's pantry inventory so the
right quantities can be deducted after cooking.

Recipe ingredients (name and measure as written in the recipe):
{ingredients_json}

Pantry items currently in stock (id, name, quantity, unit):
{pantry_json}

For each recipe ingredient that has a plausible match among the pantry
items above (e.g. "fresh spinach" matching a pantry item named "spinach"),
report:
- pantry_item_id: copy the matching pantry item's id exactly from the list
  above — never invent one
- pantry_item_name: the matching pantry item's name, as stored
- quantity_to_deduct: your best estimate of how much of that pantry item's
  quantity this recipe uses, in the pantry item's own unit — convert the
  recipe's measure as needed
- unit: the pantry item's unit
- confidence: a number from 0.0 to 1.0 for how sure you are this is the
  right pantry item and the estimated quantity is reasonable

Skip recipe ingredients with no plausible pantry match (the user doesn't
have anything like it in stock) — don't include them in the output.

Respond with ONLY a JSON array of objects, each with exactly the keys
"pantry_item_id", "pantry_item_name", "quantity_to_deduct", "unit", and
"confidence". No prose, no markdown code fences.
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


def get_recipe(recipe_id: str) -> dict[str, Any]:
    return (
        _supabase()
        .table("recipes")
        .select("id, title, ingredients")
        .eq("id", recipe_id)
        .single()
        .execute()
        .data
    )


def _extract_json_list(response_text: str) -> list[dict[str, Any]]:
    """Pull the `[...]` array out of a response, tolerating stray prose.

    Sonnet/Haiku occasionally preface a JSON response with a sentence of
    explanation despite "no prose" instructions, so this scans for the
    array boundaries rather than assuming the whole trimmed response is
    valid JSON — same tolerant-parsing approach as
    agents/meal_recommender.py's `_extract_json_list`.
    """
    text = response_text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON array found in response: {text!r}")

    items = json.loads(text[start : end + 1])
    if not isinstance(items, list):
        raise ValueError(f"Expected a JSON array of deductions, got: {type(items)}")
    return items


def build_deduction_plan(recipe_id: str, user_id: str) -> list[dict[str, Any]]:
    """Fuzzy-match a recipe's ingredients against the user's pantry stock.

    Returns `[{pantry_item_id, pantry_item_name, quantity_to_deduct, unit,
    confidence}]` — nothing is deducted yet, this is the plan for the user
    to review.
    """
    recipe = get_recipe(recipe_id)
    pantry_items = pantry_inventory.list_items(user_id)
    if not pantry_items:
        return []

    prompt = _DEDUCTION_INSTRUCTIONS.format(
        ingredients_json=json.dumps(recipe["ingredients"]),
        pantry_json=json.dumps(
            [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "quantity": item.get("quantity"),
                    "unit": item.get("unit"),
                }
                for item in pantry_items
            ]
        ),
    )
    response = _anthropic().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, messages=[{"role": "user", "content": prompt}]
    )
    response_text = "".join(block.text for block in response.content if block.type == "text")
    return _extract_json_list(response_text)


def _mark_cooked(supabase: Client, user_id: str, recipe_id: str) -> None:
    """Flip the most recent un-cooked history row to confirmed, or insert
    one if the recipe was cooked without ever going through recommend()."""
    now = datetime.now(timezone.utc).isoformat()

    existing = (
        supabase.table("user_recipe_history")
        .select("id")
        .eq("user_id", user_id)
        .eq("recipe_id", recipe_id)
        .eq("confirmed_cooked", False)
        .order("viewed_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        supabase.table("user_recipe_history").update(
            {"cooked_at": now, "confirmed_cooked": True}
        ).eq("id", existing[0]["id"]).execute()
    else:
        supabase.table("user_recipe_history").insert(
            {
                "user_id": user_id,
                "recipe_id": recipe_id,
                "cooked_at": now,
                "confirmed_cooked": True,
            }
        ).execute()


def apply_deduction(
    user_id: str, recipe_id: str, plan: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Execute a user-confirmed deduction plan: subtract quantities, flip
    `is_depleted` where stock hits zero or below, and record the cook."""
    supabase = _supabase()
    updated_items: list[dict[str, Any]] = []

    for entry in plan:
        pantry_item_id = entry["pantry_item_id"]
        current = (
            supabase.table("pantry_items")
            .select("quantity")
            .eq("id", pantry_item_id)
            .single()
            .execute()
            .data
        )
        current_quantity = current.get("quantity") or 0
        new_quantity = current_quantity - entry["quantity_to_deduct"]

        updated = (
            supabase.table("pantry_items")
            .update({"quantity": max(new_quantity, 0), "is_depleted": new_quantity <= 0})
            .eq("id", pantry_item_id)
            .execute()
            .data
        )
        updated_items.extend(updated)

    _mark_cooked(supabase, user_id, recipe_id)
    return updated_items


def _cli() -> None:
    load_dotenv()

    arg_parser = argparse.ArgumentParser(
        description="Build or apply a pantry deduction plan for cooking a recipe."
    )
    arg_parser.add_argument("--recipe-id", required=True)
    arg_parser.add_argument("--user-id", required=True)
    arg_parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply a confirmed plan instead of building one for review",
    )
    arg_parser.add_argument(
        "--plan-file", help="Path to a JSON file with the confirmed plan (required with --apply)"
    )
    args = arg_parser.parse_args()

    if args.apply:
        if not args.plan_file:
            raise SystemExit("--plan-file is required with --apply")
        with open(args.plan_file, "r", encoding="utf-8") as f:
            plan = json.load(f)
        updated_items = apply_deduction(args.user_id, args.recipe_id, plan)
        print(json.dumps({"updated_items": updated_items}, default=str))
    else:
        plan = build_deduction_plan(args.recipe_id, args.user_id)
        print(json.dumps({"plan": plan}, default=str))


if __name__ == "__main__":
    _cli()
