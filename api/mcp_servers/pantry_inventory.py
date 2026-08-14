"""MCP server exposing tools for reading and updating pantry inventory.

The plain `list_items` / `upsert_items` functions below do the actual
Supabase work and are also imported directly by
`api/workflows/receipt_parsing.py`, which needs the same data without going
through the MCP protocol — mirrors the pattern in
`api/mcp_servers/recipe_database.py`.

Uses the Supabase service role key (bypasses RLS) rather than a per-user
session, since this runs as a trusted backend process — callers pass the
target `user_id` explicitly on every call.
"""

from __future__ import annotations

import os
from typing import Any

from supabase import Client, create_client

from mcp.server import MCPServer

_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        )
    return _client


def list_items(user_id: str, include_depleted: bool = False) -> list[dict[str, Any]]:
    """List a user's pantry items, most recently purchased first."""
    query = (
        _get_client()
        .table("pantry_items")
        .select("*")
        .eq("user_id", user_id)
        .order("purchase_date", desc=True)
    )
    if not include_depleted:
        query = query.eq("is_depleted", False)
    return query.execute().data


def upsert_items(user_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert a batch of pantry items for a user.

    Each item must have `name` and `purchase_date`; `quantity`, `unit`, and
    `expiry_date` are optional. Returns the inserted rows (with generated
    ids) as stored.
    """
    if not items:
        return []

    rows = [
        {
            "user_id": user_id,
            "name": item["name"],
            "quantity": item.get("quantity"),
            "unit": item.get("unit"),
            "purchase_date": item["purchase_date"],
            "expiry_date": item.get("expiry_date"),
        }
        for item in items
    ]
    return _get_client().table("pantry_items").insert(rows).execute().data


mcp = MCPServer(name="pantry-inventory")


@mcp.tool()
def list_pantry_items(user_id: str, include_depleted: bool = False) -> list[dict[str, Any]]:
    """List a user's pantry items (excludes depleted items by default)."""
    return list_items(user_id, include_depleted=include_depleted)


@mcp.tool()
def add_pantry_items(user_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add a batch of items to a user's pantry inventory."""
    return upsert_items(user_id, items)


def serve() -> None:
    mcp.run()


if __name__ == "__main__":
    serve()
