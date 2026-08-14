"""FastAPI service wrapping MealMind's Python agents/workflows.

Deploys as its own always-on service on Railway (see nixpacks.toml,
railway.json — both in this directory, Railway's Root Directory is api/) so
the Next.js frontend on Vercel can reach it over HTTP. Vercel's serverless
functions have no Python interpreter or project .venv to spawn a subprocess
into, which is what every `app/api/*/route.ts` did before this service
existed — see DEPLOYMENT.md for the full story.

api/ is a self-contained service: agents/, workflows/, and mcp_servers/
live inside it as direct siblings of this file, not one level up at the
repo root — Railway's build only includes files under its configured Root
Directory, so a sibling-of-api/ layout would leave those imports unresolved
in production.

Run locally with this directory (api/) as the working directory:
    cd api && uvicorn main:app --reload
(matches exactly how nixpacks.toml/Railway invoke it in production.)
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from supabase import Client, create_client  # noqa: E402

from agents import meal_recommender, pantry_deductor, shopping_list  # noqa: E402
from workflows import receipt_parsing  # noqa: E402

_supabase_client: Client | None = None


def _supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        )
    return _supabase_client


def _require_internal_api_key(x_internal_api_key: str | None = Header(default=None)) -> None:
    """Gate every endpoint behind a shared secret only Next.js knows.

    This service holds the Supabase service role key (bypasses RLS) and
    every endpoint takes a caller-supplied `user_id` to act on that user's
    data — without this check, anyone who found the Railway URL could read
    or write any user's pantry/recipes/shopping list just by supplying
    their id. Not part of the original task spec; added because standing
    up a publicly reachable service with those properties and no caller
    verification is a real vulnerability, not a hypothetical one.
    """
    expected = os.environ.get("INTERNAL_API_KEY")
    if not expected or x_internal_api_key != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid internal API key")


def _require_user(user_id: str) -> None:
    """Validate `user_id` refers to a real row in `users` before proceeding."""
    result = (
        _supabase().table("users").select("id").eq("id", user_id).limit(1).execute().data
    )
    if not result:
        raise HTTPException(status_code=404, detail=f"No user found with id {user_id!r}")


app = FastAPI(
    title="MealMind Python API",
    dependencies=[Depends(_require_internal_api_key)],
)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class RecommendRequest(BaseModel):
    user_id: str


class CustomRecipeRequest(BaseModel):
    user_id: str
    request: str


class DeductionItem(BaseModel):
    pantry_item_id: str
    pantry_item_name: str
    quantity_to_deduct: float
    unit: str
    confidence: float


class ConfirmCookRequest(BaseModel):
    user_id: str
    recipe_id: str
    confirmed: bool = False
    plan: list[DeductionItem] | None = None


class ShoppingListRequest(BaseModel):
    user_id: str


class PantryItemUpdate(BaseModel):
    user_id: str
    quantity: float | None = None
    is_depleted: bool | None = None


_IMAGE_EXTENSIONS_BY_MIME_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
_ALLOWED_FILE_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"}


def _resolve_extension(filename: str | None, content_type: str | None) -> str:
    if content_type == "application/pdf":
        return ".pdf"
    if content_type in _IMAGE_EXTENSIONS_BY_MIME_TYPE:
        return _IMAGE_EXTENSIONS_BY_MIME_TYPE[content_type]
    ext = Path(filename or "").suffix.lower()
    if ext in _ALLOWED_FILE_EXTENSIONS:
        return ext
    raise HTTPException(
        status_code=400,
        detail="Unsupported file type — upload an image (jpg/png/gif/webp) or PDF",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/parse-receipt")
async def parse_receipt(
    user_id: str = Form(...),
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
) -> dict[str, Any]:
    _require_user(user_id)

    has_file = file is not None and file.size and file.size > 0
    has_text = bool(text and text.strip())
    if not has_file and not has_text:
        raise HTTPException(
            status_code=400, detail="Provide a receipt file (image or PDF) or paste receipt text"
        )

    try:
        if has_file:
            assert file is not None
            extension = _resolve_extension(file.filename, file.content_type)
            with tempfile.TemporaryDirectory() as tmp_dir:
                file_path = os.path.join(tmp_dir, f"receipt{extension}")
                with open(file_path, "wb") as f:
                    f.write(await file.read())
                result = receipt_parsing.run(file_path, user_id)
        else:
            result = receipt_parsing.run(text, user_id)  # type: ignore[arg-type]
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller, not swallowed
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return result


@app.post("/recommend")
def recommend(body: RecommendRequest) -> dict[str, Any]:
    _require_user(body.user_id)
    try:
        recipes = meal_recommender.recommend(body.user_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"recipes": recipes}


@app.post("/custom-recipe")
def custom_recipe(body: CustomRecipeRequest) -> dict[str, Any]:
    _require_user(body.user_id)
    if not body.request.strip():
        raise HTTPException(status_code=400, detail="request text is required")
    try:
        recipes = meal_recommender.generate_custom_recipe(body.user_id, body.request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"recipes": recipes}


@app.post("/confirm-cook")
def confirm_cook(body: ConfirmCookRequest) -> dict[str, Any]:
    _require_user(body.user_id)
    try:
        if not body.confirmed:
            plan = pantry_deductor.build_deduction_plan(body.recipe_id, body.user_id)
            return {"plan": plan}

        if not body.plan:
            raise HTTPException(status_code=400, detail="plan is required to confirm a cook")
        updated_items = pantry_deductor.apply_deduction(
            body.user_id, body.recipe_id, [item.model_dump() for item in body.plan]
        )
        return {"updated_items": updated_items}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/shopping-list")
def shopping_list_endpoint(body: ShoppingListRequest) -> dict[str, Any]:
    _require_user(body.user_id)
    try:
        items = shopping_list.generate_shopping_list(body.user_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"items": items}


@app.patch("/pantry-items/{item_id}")
def update_pantry_item(item_id: str, body: PantryItemUpdate) -> dict[str, Any]:
    _require_user(body.user_id)

    updates: dict[str, Any] = {}
    if "quantity" in body.model_fields_set:
        updates["quantity"] = body.quantity
    if "is_depleted" in body.model_fields_set:
        updates["is_depleted"] = body.is_depleted
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        _supabase()
        .table("pantry_items")
        .update(updates)
        .eq("id", item_id)
        .eq("user_id", body.user_id)
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Pantry item not found")
    return {"item": result[0]}
