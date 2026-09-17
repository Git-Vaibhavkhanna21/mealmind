"""One-time script: backfill `recipes.thumbnail_url` for rows seeded before
migrations/0003_add_thumbnail_url.sql existed.

`seed_recipes.py` now writes `thumbnail_url` for every row it upserts, but
re-running it against the ~200 already-seeded recipes would re-embed all of
them for no reason (an OPENAI_API_KEY-billed call per recipe just to fill in
a column the embedding never depended on). This script instead re-fetches
each recipe missing a thumbnail from TheMealDB by `themealdb_id` — the same
`fetch_recipe_by_id` seed_recipes.py already uses — and only updates
`thumbnail_url`, leaving everything else (including `embedding`) untouched.

Requires SUPABASE_URL and SUPABASE_SERVICE_KEY. Does not require
OPENAI_API_KEY — no embeddings are touched.

Usage:
    .venv/bin/python database/backfill_thumbnails.py
"""

from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from supabase import Client, create_client

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api.mcp_servers.recipe_database import fetch_recipe_by_id  # noqa: E402

load_dotenv()

FETCH_WORKERS = 4


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def fetch_rows_missing_thumbnail(supabase: Client) -> list[dict[str, str]]:
    response = (
        supabase.table("recipes")
        .select("id, themealdb_id")
        .is_("thumbnail_url", "null")
        .execute()
    )
    return response.data


def fetch_thumbnail(row: dict[str, str]) -> tuple[str, str | None]:
    recipe = fetch_recipe_by_id(row["themealdb_id"])
    return row["id"], recipe["thumbnail"] if recipe else None


def main() -> None:
    supabase = create_client(
        require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_KEY")
    )

    rows = fetch_rows_missing_thumbnail(supabase)
    print(f"Found {len(rows)} recipes missing thumbnail_url.")
    if not rows:
        return

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        results = list(pool.map(fetch_thumbnail, rows))

    updated = 0
    skipped = 0
    for row_id, thumbnail_url in results:
        if not thumbnail_url:
            skipped += 1
            continue
        supabase.table("recipes").update({"thumbnail_url": thumbnail_url}).eq(
            "id", row_id
        ).execute()
        updated += 1

    print(f"Done. Updated {updated} recipes, skipped {skipped} with no thumbnail on TheMealDB.")


if __name__ == "__main__":
    main()
