"""One-time script: seed the Supabase `recipes` table from TheMealDB.

Fetches ~200 recipes spread across several TheMealDB categories, embeds
each one with OpenAI's text-embedding-3-small (1536 dims, matching the
`recipes.embedding vector(1536)` column), and upserts the rows into
Supabase keyed on `themealdb_id` — safe to re-run.

Requires OPENAI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY (the
service role key is required, not the anon key, since RLS on `recipes`
only grants authenticated users read access — see
database/migrations/0001_init.sql).

Usage:
    .venv/bin/python database/seed_recipes.py
"""

from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from supabase import Client, create_client

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api.mcp_servers.recipe_database import (  # noqa: E402
    fetch_categories,
    fetch_recipe_by_id,
    fetch_recipe_summaries_by_category,
)

load_dotenv()

TARGET_RECIPE_COUNT = 200

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_BATCH_SIZE = 50
FETCH_WORKERS = 4


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def collect_meal_ids(categories: list[str]) -> list[str]:
    """Spread ~TARGET_RECIPE_COUNT recipes across every TheMealDB category.

    Each category first contributes an even share; categories with fewer
    recipes than their share (e.g. Vegan, Goat) fall short, so a second pass
    tops up from categories that still have unused recipes until the target
    is hit or the whole catalog is exhausted.
    """
    summaries_by_category = {c: fetch_recipe_summaries_by_category(c) for c in categories}
    per_category = TARGET_RECIPE_COUNT // len(categories)

    meal_ids: list[str] = []
    seen: set[str] = set()

    def take_from(category: str, limit: int) -> int:
        added = 0
        for summary in summaries_by_category[category]:
            if added >= limit:
                break
            meal_id = summary["idMeal"]
            if meal_id in seen:
                continue
            seen.add(meal_id)
            meal_ids.append(meal_id)
            added += 1
        return added

    for category in categories:
        added = take_from(category, per_category)
        print(f"  {category}: queued {added} recipes")

    for category in categories:
        if len(meal_ids) >= TARGET_RECIPE_COUNT:
            break
        added = take_from(category, TARGET_RECIPE_COUNT - len(meal_ids))
        if added:
            print(f"  {category}: topped up {added} more recipes")

    return meal_ids[:TARGET_RECIPE_COUNT]


def fetch_recipes(meal_ids: list[str]) -> list[dict[str, Any]]:
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        recipes = list(pool.map(fetch_recipe_by_id, meal_ids))
    return [r for r in recipes if r is not None]


def embedding_text(recipe: dict[str, Any]) -> str:
    ingredient_names = ", ".join(i["name"] for i in recipe["ingredients"])
    return (
        f"{recipe['title']}\n"
        f"Cuisine: {recipe['cuisine'] or 'Unknown'}\n"
        f"Ingredients: {ingredient_names}\n"
        f"Instructions: {recipe['instructions'] or ''}"
    )


def embed_recipes(
    openai_client: OpenAI, recipes: list[dict[str, Any]]
) -> list[list[float]]:
    embeddings: list[list[float]] = []
    for start in range(0, len(recipes), EMBEDDING_BATCH_SIZE):
        batch = recipes[start : start + EMBEDDING_BATCH_SIZE]
        response = openai_client.embeddings.create(
            input=[embedding_text(r) for r in batch],
            model=EMBEDDING_MODEL,
        )
        embeddings.extend(item.embedding for item in response.data)
        print(f"  embedded {start + len(batch)}/{len(recipes)}")
    return embeddings


def to_pgvector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


def upsert_recipes(
    supabase: Client, recipes: list[dict[str, Any]], embeddings: list[list[float]]
) -> None:
    rows = [
        {
            "themealdb_id": recipe["themealdb_id"],
            "title": recipe["title"],
            "ingredients": recipe["ingredients"],
            "instructions": recipe["instructions"],
            "cuisine": recipe["cuisine"],
            "prep_time": recipe["prep_time"],
            "embedding": to_pgvector_literal(embedding),
        }
        for recipe, embedding in zip(recipes, embeddings)
    ]

    for start in range(0, len(rows), EMBEDDING_BATCH_SIZE):
        batch = rows[start : start + EMBEDDING_BATCH_SIZE]
        supabase.table("recipes").upsert(batch, on_conflict="themealdb_id").execute()
        print(f"  upserted {start + len(batch)}/{len(rows)}")


def main() -> None:
    openai_client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    supabase = create_client(
        require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_KEY")
    )

    categories = fetch_categories()
    print(f"Collecting up to {TARGET_RECIPE_COUNT} recipe ids across {len(categories)} categories...")
    meal_ids = collect_meal_ids(categories)
    print(f"Collected {len(meal_ids)} meal ids.")

    print("Fetching full recipe details...")
    recipes = fetch_recipes(meal_ids)
    print(f"Fetched {len(recipes)} recipes.")

    print(f"Generating embeddings with {EMBEDDING_MODEL}...")
    embeddings = embed_recipes(openai_client, recipes)

    print("Upserting into Supabase...")
    upsert_recipes(supabase, recipes, embeddings)

    print(f"Done. Seeded {len(recipes)} recipes.")


if __name__ == "__main__":
    main()
