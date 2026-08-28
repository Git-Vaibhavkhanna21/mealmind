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

Follow these rules when normalizing each item:

1. Unit handling for count items: For items measured by count such as eggs,
   avocados, onions, bananas, garlic bulbs, and similar items that are not
   measured by weight or volume, set unit to null. Do not use each, pieces,
   or bunch as a unit.
2. Brand name stripping: Strip brand names and return only the generic
   product name. Examples: Nandos Peri Peri Sauce -> peri peri sauce.
   Philadelphia Cream Cheese -> cream cheese. Warburtons Seeded Batch Loaf
   -> seeded bread.
3. Qualifier stripping: Strip production and sourcing qualifiers only:
   organic, free range, unsalted, homemade, natural, fresh (when used as a
   generic freshness descriptor). Do NOT strip variety descriptors that
   identify a specific product: baby spinach is a specific variety distinct
   from spinach — keep it. Cherry tomatoes are distinct from tomatoes —
   keep it. Sourdough bread is distinct from bread — keep it. Mozzarella di
   bufala is distinct from mozzarella — keep it.
4. Multiplier expansion and unit conversion: When an item has a multiplier
   such as 2 x greek yogurt 500g, create two separate entries each with
   quantity 500 and unit g. Convert ONLY written-out colloquial
   descriptions to metric: the word pound followed by of (e.g. pound of
   turkey) -> 453g. The word dozen -> 12 items. The phrase half gallon ->
   1.89L. Do NOT convert already-abbreviated units like 1lb, 4 pints, 2oz
   — keep those exactly as written with standard abbreviations.
5. Unit abbreviation format: Always use standard abbreviations for units:
   g (not gram), kg (not kilogram), L (not litre), ml (not millilitre), lb
   (not pound), pint (not pints). Never spell out unit names in full.
6. Generic liquids and ingredients with no stated quantity: For generic
   liquid or ingredient names with no quantity stated (e.g. water, oil,
   salt), return quantity: 1 and unit: null.

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
