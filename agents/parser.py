"""Parses raw input (e.g. receipts, text) into structured pantry items.

Receipt OCR/text output is unstructured and inconsistent — abbreviated item
names, merged lines, store-specific formatting — so turning it into
normalized `(name, quantity, unit)` records is delegated to Claude Haiku
rather than pattern-matched. See the "Workflows vs. agents" section of the
README for the rationale.

Callers are expected to have already reduced the input to either an image
(bytes, still on disk) or plain text — extracting text from a PDF is
deterministic work that belongs in the calling workflow, not here.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
from typing import Any

from anthropic import Anthropic

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 2048

_EXTRACTION_INSTRUCTIONS = """\
You are extracting a structured grocery item list from a receipt.

Read the receipt content and identify every purchased grocery item. For each
item, estimate:
- name: a normalized, human-readable item name (e.g. "whole milk", not
  "WHL MLK 1GAL")
- quantity: a numeric estimate of how much was purchased (default to 1 if
  the receipt doesn't make this clear)
- unit: a short unit string (e.g. "gallon", "lb", "oz", "each", "bunch")

Ignore non-grocery lines: subtotals, tax, totals, payment info, loyalty
program text, coupons, and store header/footer text.

Respond with ONLY a JSON array of objects, each with exactly the keys
"name", "quantity", and "unit". No prose, no markdown code fences. If no
grocery items are found, respond with an empty JSON array: []
"""


def _client() -> Anthropic:
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def _extract_json_items(response_text: str) -> list[dict[str, Any]]:
    text = response_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json"):]
        text = text.strip()

    items = json.loads(text)
    if not isinstance(items, list):
        raise ValueError(f"Expected a JSON array of items, got: {type(items)}")
    return items


def _media_type_for(image_path: str) -> str:
    guessed, _ = mimetypes.guess_type(image_path)
    if guessed in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        return guessed
    return "image/jpeg"


def parse_receipt_image(image_path: str) -> list[dict[str, Any]]:
    """Extract grocery items from a receipt photo/scan via Claude vision."""
    with open(image_path, "rb") as f:
        image_b64 = base64.standard_b64encode(f.read()).decode("utf-8")

    response = _client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": _media_type_for(image_path),
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": _EXTRACTION_INSTRUCTIONS},
                ],
            }
        ],
    )
    response_text = "".join(
        block.text for block in response.content if block.type == "text"
    )
    return _extract_json_items(response_text)


def parse_receipt_text(text: str) -> list[dict[str, Any]]:
    """Extract grocery items from receipt text (typed, or PDF-extracted)."""
    response = _client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": f"{_EXTRACTION_INSTRUCTIONS}\n\nReceipt content:\n{text}",
            }
        ],
    )
    response_text = "".join(
        block.text for block in response.content if block.type == "text"
    )
    return _extract_json_items(response_text)


def parse(raw_input: str) -> list[dict[str, Any]]:
    """Plain-text entry point, kept for callers that only ever hand off text."""
    return parse_receipt_text(raw_input)
