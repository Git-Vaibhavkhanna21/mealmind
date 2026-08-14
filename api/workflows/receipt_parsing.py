"""Workflow: ingest a receipt, parse it, and add items to pantry inventory.

The steps here (route by input type -> extract -> attach purchase date ->
estimate expiry -> persist) never branch based on what a model returns —
always run in this order — so this stays a deterministic workflow. Every
step that requires judgment (reading the receipt, estimating shelf life) is
delegated to `api/agents/parser.py` and `api/workflows/expiration_workflow.py`.

Can be run as a script (see `_cli` below) so a non-Python caller — the
Next.js API route at `frontend/app/api/parse-receipt/route.ts` — can invoke
it as a subprocess and read the result back as JSON on stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pdfplumber  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from agents import parser as receipt_parser  # noqa: E402
from mcp_servers import pantry_inventory  # noqa: E402
from workflows import expiration_workflow  # noqa: E402

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def _extract_pdf_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(pages_text)


def _parse_receipt(source: str) -> list[dict[str, Any]]:
    """Route `source` to the right extraction path based on what it is.

    `source` is either a path to an image, a path to a PDF, or a plain text
    string (e.g. a pasted receipt) — never OCR'd/pre-processed by the
    caller, per the workflow's contract.
    """
    if os.path.isfile(source):
        ext = os.path.splitext(source)[1].lower()
        if ext == ".pdf":
            return receipt_parser.parse_receipt_text(_extract_pdf_text(source))
        if ext in _IMAGE_EXTENSIONS:
            return receipt_parser.parse_receipt_image(source)
        raise ValueError(f"Unsupported receipt file type: {ext}")

    return receipt_parser.parse_receipt_text(source)


def run(source: str, user_id: str) -> dict[str, Any]:
    """Parse a receipt and write the enriched items to the user's pantry.

    `source` is a file path (image or PDF) or a plain text string. Returns
    `{"items": [...]}` with the pantry rows as stored (including generated
    ids and the estimated `expiry_date`).
    """
    raw_items = _parse_receipt(source)

    purchase_date = date.today().isoformat()
    items = [
        {
            "name": item["name"],
            "quantity": item.get("quantity"),
            "unit": item.get("unit"),
            "purchase_date": purchase_date,
        }
        for item in raw_items
    ]

    enriched_items = expiration_workflow.estimate_expirations(items)
    saved_items = pantry_inventory.upsert_items(user_id, enriched_items)

    return {"items": saved_items}


def _cli() -> None:
    load_dotenv()

    arg_parser = argparse.ArgumentParser(
        description="Parse a receipt and add the items to a user's pantry."
    )
    arg_parser.add_argument("--user-id", required=True, help="Pantry owner's user id")
    source_group = arg_parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--image", help="Path to a receipt image")
    source_group.add_argument("--pdf", help="Path to a receipt PDF")
    source_group.add_argument("--text-file", help="Path to a file of receipt text")
    source_group.add_argument("--text", help="Raw receipt text")
    args = arg_parser.parse_args()

    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            source = f.read()
    else:
        source = args.image or args.pdf or args.text

    result = run(source, args.user_id)
    print(json.dumps(result, default=str))


if __name__ == "__main__":
    _cli()
