"""Recommends meals based on current pantry contents and expiring items.

Ranking retrieved recipes against pantry contents, expiring items, and user
preferences is an open-ended judgment call — there's no fixed rule for
"best meal to cook tonight" — so the final selection is delegated to Claude
Sonnet. Sonnet isn't handed the whole recipe catalog, though: a pgvector
similarity search over `recipes.embedding` (see
`database/migrations/0002_match_recipes.sql`) narrows the field to a short
list first, keeping the reasoning step's token cost bounded regardless of
catalog size. See the "RAG for recipe retrieval" section of the README.

`recommend` is the pantry-driven path (prioritizes what's expiring soonest);
`generate_custom_recipe` is the free-text path ("I want to use up the
spinach", "I feel like pasta tonight") — same retrieval, but Sonnet also
judges whether the request wants one specific dish or an open-ended set of
options.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anthropic import Anthropic  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from openai import OpenAI  # noqa: E402
from supabase import Client, create_client  # noqa: E402

from mcp_servers import pantry_inventory  # noqa: E402

SONNET_MODEL = "claude-sonnet-4-6"
EMBEDDING_MODEL = "text-embedding-3-small"
MAX_TOKENS = 3072
CANDIDATE_COUNT = 10
RECOMMENDATION_COUNT = 3
PRIORITY_ITEM_COUNT = 3

_CUSTOM_COUNT_INSTRUCTION = (
    "Decide how many recipes to return based on the request: if it names "
    'one specific dish (e.g. "pasta tonight", "chicken curry"), return '
    "exactly 1 recipe. If it's open-ended (e.g. \"use up the spinach\", "
    '"something quick"), return exactly 3 recipes.'
)

_SELECTION_INSTRUCTIONS = """\
You are recommending recipes for a home cook based on their pantry and \
preferences.

User preferences: {preferences_text}

Pantry contents (soonest-expiring first):
{pantry_json}

Candidate recipes (retrieved by semantic similarity to the pantry state and \
preferences):
{candidates_json}
{request_clause}
{count_instruction}

For each recipe you select, use the ingredients and instructions from the
matching candidate — don't invent a different recipe. "pantry_items_used"
must only list pantry item names (from the pantry contents above) that the
recipe actually uses. The candidates don't carry a reliable prep time, so
estimate "prep_time_minutes" yourself from the instructions and ingredient
count. "reason" must be exactly one sentence explaining why this recipe fits
this pantry and these preferences right now.

Respond with ONLY a JSON array of objects, each with exactly the keys
"recipe_id", "title", "ingredients" (array of strings), "pantry_items_used"
(array of strings), "prep_time_minutes" (integer), and "reason" (string). No
prose, no markdown code fences.
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


def _openai() -> OpenAI:
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def get_pantry_state(user_id: str) -> list[dict[str, Any]]:
    """Non-depleted pantry items, soonest-expiring first (no estimate last)."""
    items = pantry_inventory.list_items(user_id)
    return sorted(items, key=lambda item: item["expiry_date"] or "9999-12-31")


def get_preferences(user_id: str) -> dict[str, Any]:
    return (
        _supabase()
        .table("users")
        .select("cooking_skill, dietary_restrictions, max_cooking_time")
        .eq("id", user_id)
        .single()
        .execute()
        .data
    )


def _preference_clauses(preferences: dict[str, Any]) -> list[str]:
    clauses = []
    if preferences.get("cooking_skill"):
        clauses.append(f"{preferences['cooking_skill']} cooking skill")
    restrictions = preferences.get("dietary_restrictions") or []
    if restrictions:
        clauses.append(", ".join(f"no {r}" for r in restrictions))
    if preferences.get("max_cooking_time"):
        clauses.append(f"{preferences['max_cooking_time']} minutes max")
    return clauses


def _build_query_text(pantry_items: list[dict[str, Any]], preferences: dict[str, Any]) -> str:
    """Natural-language query embedded for the pgvector similarity search."""
    clauses = _preference_clauses(preferences)

    urgent_pieces = []
    today = date.today()
    for item in pantry_items[:PRIORITY_ITEM_COUNT]:
        if not item.get("expiry_date"):
            continue
        days_left = (date.fromisoformat(item["expiry_date"]) - today).days
        unit = "day" if days_left == 1 else "days"
        urgent_pieces.append(f"{item['name']} expiring in {days_left} {unit}")
    if urgent_pieces:
        clauses.append("prioritise " + " and ".join(urgent_pieces))

    return ", ".join(clauses) if clauses else "no specific preferences"


def _embed(text: str) -> list[float]:
    response = _openai().embeddings.create(input=[text], model=EMBEDDING_MODEL)
    return response.data[0].embedding


def _search_recipes(embedding: list[float], match_count: int = CANDIDATE_COUNT) -> list[dict[str, Any]]:
    response = _supabase().rpc(
        "match_recipes", {"query_embedding": embedding, "match_count": match_count}
    ).execute()
    return response.data


def _extract_json_list(response_text: str) -> list[dict[str, Any]]:
    """Pull the `[...]` array out of a response, tolerating stray prose.

    Despite the "no prose" instruction, Sonnet occasionally prefaces the
    array with a sentence or two (e.g. explaining why it's returning an
    empty list), so this scans for the array boundaries rather than
    assuming the whole trimmed response is valid JSON.
    """
    text = response_text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON array found in response: {text!r}")

    items = json.loads(text[start : end + 1])
    if not isinstance(items, list):
        raise ValueError(f"Expected a JSON array of recipes, got: {type(items)}")
    return items


def _select_recipes(
    pantry_items: list[dict[str, Any]],
    preferences: dict[str, Any],
    candidates: list[dict[str, Any]],
    count_instruction: str,
    request_text: str | None = None,
) -> list[dict[str, Any]]:
    prompt = _SELECTION_INSTRUCTIONS.format(
        preferences_text=", ".join(_preference_clauses(preferences)) or "no stated preferences",
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
        candidates_json=json.dumps(
            [
                {
                    "recipe_id": c["id"],
                    "title": c["title"],
                    "ingredients": c["ingredients"],
                    "instructions": c["instructions"],
                    "cuisine": c["cuisine"],
                }
                for c in candidates
            ]
        ),
        request_clause=f'\nUser\'s request: "{request_text}"\n' if request_text else "",
        count_instruction=count_instruction,
    )

    response = _anthropic().messages.create(
        model=SONNET_MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = "".join(block.text for block in response.content if block.type == "text")
    return _extract_json_list(response_text)


def _save_history(user_id: str, recipe_ids: list[str]) -> None:
    if not recipe_ids:
        return
    rows = [{"user_id": user_id, "recipe_id": recipe_id} for recipe_id in recipe_ids]
    _supabase().table("user_recipe_history").insert(rows).execute()


def recommend(user_id: str) -> list[dict[str, Any]]:
    """The 3 recipes that best use the user's pantry, prioritizing what's
    closest to expiring, filtered through their cooking preferences."""
    pantry_items = get_pantry_state(user_id)
    preferences = get_preferences(user_id)

    query_text = _build_query_text(pantry_items, preferences)
    candidates = _search_recipes(_embed(query_text))

    recipes = _select_recipes(
        pantry_items, preferences, candidates, count_instruction="Select exactly 3 recipes."
    )
    _save_history(user_id, [r["recipe_id"] for r in recipes if r.get("recipe_id")])
    return recipes


def generate_custom_recipe(user_id: str, request_text: str) -> list[dict[str, Any]]:
    """1 or 3 recipes (Sonnet's judgment) matching a free-text request."""
    pantry_items = get_pantry_state(user_id)
    preferences = get_preferences(user_id)

    candidates = _search_recipes(_embed(request_text))

    recipes = _select_recipes(
        pantry_items,
        preferences,
        candidates,
        count_instruction=_CUSTOM_COUNT_INSTRUCTION,
        request_text=request_text,
    )
    _save_history(user_id, [r["recipe_id"] for r in recipes if r.get("recipe_id")])
    return recipes


def _cli() -> None:
    load_dotenv()

    arg_parser = argparse.ArgumentParser(description="Generate meal recommendations for a user.")
    arg_parser.add_argument("--user-id", required=True)
    arg_parser.add_argument(
        "--custom", help='Custom recipe request text, e.g. "I feel like pasta tonight"'
    )
    args = arg_parser.parse_args()

    recipes = (
        generate_custom_recipe(args.user_id, args.custom) if args.custom else recommend(args.user_id)
    )
    print(json.dumps(recipes, indent=2))


if __name__ == "__main__":
    _cli()
