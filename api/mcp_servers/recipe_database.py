"""MCP server exposing tools for querying TheMealDB recipe API.

Wraps TheMealDB's free JSON API (https://www.themealdb.com/api.php) behind
MCP tools so agents call `query_recipes_by_ingredients`, `get_recipe_by_id`,
etc. without knowing the upstream API shape. See the "Why MCP servers
instead of direct API calls" section of the README for the rationale.

The plain `fetch_*` / `normalize_recipe` functions below do the actual HTTP
work and are also imported directly by `database/seed_recipes.py`, which
needs the same data without going through the MCP protocol.
"""

from __future__ import annotations

import os
import time
from typing import Any

import requests

from mcp.server import MCPServer

THEMEALDB_API_KEY = os.environ.get("THEMEALDB_API_KEY", "1")
THEMEALDB_BASE_URL = f"https://www.themealdb.com/api/json/v1/{THEMEALDB_API_KEY}"

_session = requests.Session()

_MAX_RETRIES = 5
_RETRY_BACKOFF_SECONDS = 2.0


def _get(path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    for attempt in range(_MAX_RETRIES):
        response = _session.get(f"{THEMEALDB_BASE_URL}/{path}", params=params, timeout=10)
        if response.status_code == 429 and attempt < _MAX_RETRIES - 1:
            time.sleep(_RETRY_BACKOFF_SECONDS * (2**attempt))
            continue
        response.raise_for_status()
        return response.json()
    raise AssertionError("unreachable")


def normalize_recipe(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw TheMealDB meal object into MealMind's recipe shape.

    TheMealDB has no prep-time field, so `prep_time` is always None here —
    left for a future enrichment step (e.g. estimated from the instructions).
    """
    ingredients = []
    for i in range(1, 21):
        name = (raw.get(f"strIngredient{i}") or "").strip()
        measure = (raw.get(f"strMeasure{i}") or "").strip()
        if name:
            ingredients.append({"name": name, "measure": measure})

    return {
        "themealdb_id": raw["idMeal"],
        "title": raw["strMeal"],
        "ingredients": ingredients,
        "instructions": raw.get("strInstructions"),
        "cuisine": raw.get("strArea"),
        "category": raw.get("strCategory"),
        "thumbnail": raw.get("strMealThumb"),
        "prep_time": None,
    }


def fetch_categories() -> list[str]:
    data = _get("categories.php")
    return [c["strCategory"] for c in data.get("categories", [])]


def fetch_recipe_summaries_by_category(category: str) -> list[dict[str, str]]:
    """Meal id/name/thumbnail only — TheMealDB's filter endpoints don't
    return full recipe details, so each id needs a follow-up lookup."""
    data = _get("filter.php", {"c": category})
    return data.get("meals") or []


def fetch_recipe_summaries_by_ingredient(ingredient: str) -> list[dict[str, str]]:
    data = _get("filter.php", {"i": ingredient})
    return data.get("meals") or []


def fetch_recipe_by_id(meal_id: str) -> dict[str, Any] | None:
    data = _get("lookup.php", {"i": meal_id})
    meals = data.get("meals")
    return normalize_recipe(meals[0]) if meals else None


def search_recipes(name: str) -> list[dict[str, Any]]:
    data = _get("search.php", {"s": name})
    return [normalize_recipe(m) for m in (data.get("meals") or [])]


def query_recipes_by_ingredients(ingredients: list[str]) -> list[dict[str, str]]:
    """Meals containing ALL of the given ingredients (summaries only)."""
    if not ingredients:
        return []

    result_sets = [fetch_recipe_summaries_by_ingredient(i) for i in ingredients]
    id_sets = [{m["idMeal"] for m in meals} for meals in result_sets]
    common_ids = set.intersection(*id_sets) if id_sets else set()

    by_id = {m["idMeal"]: m for meals in result_sets for m in meals}
    return [by_id[meal_id] for meal_id in common_ids]


mcp = MCPServer(name="recipe-database")


@mcp.tool()
def list_categories() -> list[str]:
    """List all TheMealDB recipe categories (e.g. Seafood, Vegan, Dessert)."""
    return fetch_categories()


@mcp.tool()
def list_recipes_by_category(category: str) -> list[dict[str, str]]:
    """List recipe id/name/thumbnail summaries for a TheMealDB category."""
    return fetch_recipe_summaries_by_category(category)


@mcp.tool()
def get_recipe_by_id(meal_id: str) -> dict[str, Any] | None:
    """Fetch full recipe details (ingredients, instructions, cuisine) by TheMealDB id."""
    return fetch_recipe_by_id(meal_id)


@mcp.tool()
def search_recipes_by_name(name: str) -> list[dict[str, Any]]:
    """Search TheMealDB for recipes matching a name, returning full details."""
    return search_recipes(name)


@mcp.tool()
def query_recipes_by_ingredients_tool(ingredients: list[str]) -> list[dict[str, str]]:
    """Find recipe summaries that use every ingredient given."""
    return query_recipes_by_ingredients(ingredients)


def serve() -> None:
    mcp.run()


if __name__ == "__main__":
    serve()
