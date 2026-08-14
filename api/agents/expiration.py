"""Tracks pantry item expiration dates and flags items nearing expiry.

Estimating shelf life from a bare item name ("spinach," no purchase
context) benefits from a model that knows typical spoilage patterns by
category and storage condition — see the "Model selection" section of the
README. `estimate_batch` handles the common case cheaply with Haiku in one
batched call; `estimate_with_subagent` is the fallback the calling workflow
reaches for on items Haiku isn't confident about, spending a Sonnet call to
reason through the harder single item.
"""

from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic

HAIKU_MODEL = "claude-haiku-4-5-20251001"
SUBAGENT_MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 2048
SUBAGENT_MAX_TOKENS = 1024

_BATCH_INSTRUCTIONS = """\
You are estimating grocery shelf life. Today's date is {today}.

For each item below, estimate the date it will expire based on typical
shelf life for that kind of item (assume normal home storage — fridge for
perishables, pantry for shelf-stable goods — unless the name suggests
otherwise) and its purchase date. Report your confidence:
- "high" if this is a common item with a well-known, fairly consistent
  shelf life (e.g. milk, eggs, bread, canned goods)
- "low" if the name is ambiguous, unusual, or shelf life varies a lot
  depending on details you don't have

Items:
{items_json}

Respond with ONLY a JSON array, one object per item in the same order,
each with exactly the keys "name", "expiry_date" (YYYY-MM-DD), and
"confidence" ("high" or "low"). No prose, no markdown code fences.
"""

_SUBAGENT_INSTRUCTIONS = """\
You are estimating the shelf life of a single grocery item that a faster
model was not confident about. Today's date is {today}.

Item: {item_json}

Reason briefly about what this item likely is, how it's typically stored,
and its typical shelf life, then give a final answer.

End your response with ONLY a final line containing a JSON object with
exactly the keys "name" and "expiry_date" (YYYY-MM-DD). Nothing after it.
"""


def _client() -> Anthropic:
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def _response_text(response: Any) -> str:
    return "".join(block.text for block in response.content if block.type == "text")


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json"):]
        text = text.strip()
    return json.loads(text)


def _last_json_object(text: str) -> dict[str, Any]:
    """Pull the last `{...}` block out of a reasoning response."""
    start = text.rfind("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON object found in subagent response: {text!r}")
    return json.loads(text[start : end + 1])


def estimate_batch(items: list[dict[str, Any]], today: str) -> list[dict[str, Any]]:
    """One Haiku call estimating expiry_date + confidence for every item.

    `items` need `name` (required) and may include `quantity`/`unit`; the
    returned list is in the same order as `items`, each with `name`,
    `expiry_date`, and `confidence`.
    """
    if not items:
        return []

    prompt = _BATCH_INSTRUCTIONS.format(
        today=today,
        items_json=json.dumps(
            [{"name": i["name"], "purchase_date": i.get("purchase_date")} for i in items]
        ),
    )
    response = _client().messages.create(
        model=HAIKU_MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    estimates = _extract_json(_response_text(response))
    if not isinstance(estimates, list) or len(estimates) != len(items):
        raise ValueError(
            f"Expected {len(items)} estimates back from Haiku, got: {estimates!r}"
        )
    return estimates


def estimate_with_subagent(item: dict[str, Any], today: str) -> dict[str, Any]:
    """Sonnet subagent call for a single item Haiku wasn't confident about."""
    prompt = _SUBAGENT_INSTRUCTIONS.format(
        today=today,
        item_json=json.dumps({"name": item["name"], "purchase_date": item.get("purchase_date")}),
    )
    response = _client().messages.create(
        model=SUBAGENT_MODEL,
        max_tokens=SUBAGENT_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    return _last_json_object(_response_text(response))


def check_expiring(pantry_items: list[dict]) -> list[dict]:
    """Flag items in an existing pantry that are nearing their expiry date.

    Used by the (future) scheduled expiration scan to decide what should
    trigger a meal recommendation — not part of the initial estimation path
    in `estimate_batch`/`estimate_with_subagent` above.
    """
    raise NotImplementedError
