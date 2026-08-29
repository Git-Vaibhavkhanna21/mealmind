"""LLM-as-a-judge: scores an agent's output against a rubric.

Meal recommendation and shopping list generation are open-ended judgment
calls with no single correct output to diff against (see the "Workflows vs.
agents" section of the README), so their eval fixtures are scored 0/1/2 per
criterion by Sonnet reading a rubric, rather than compared to a fixed
expected value the way receipt parsing/expiration/deduction are. Sonnet
(not Haiku) is used here for the same reason it's used for recommendation
and shopping list generation themselves — judging a rubric criterion like
"are these three recipes meaningfully different" is reasoning, not
extraction.
"""

from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 2048

_JUDGE_PROMPT = """\
{rubric_text}

You are scoring the {component} output below against the rubric above.

Input given to the system:
{input_json}

Output produced by the system:
{output_json}

Return ONLY the JSON object specified by the rubric above. No prose, no
markdown code fences, nothing before or after the JSON object.
"""


def _anthropic() -> Anthropic:
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def _extract_json_object(response_text: str) -> dict[str, Any]:
    """Pull the `{...}` object out of a response, tolerating stray prose.

    Same tolerant-boundary-scanning approach as the `_extract_json_list`
    helpers in api/agents/meal_recommender.py, api/agents/pantry_deductor.py,
    and api/agents/shopping_list.py (Sonnet/Haiku occasionally preface JSON
    output with a sentence despite "no prose" instructions) — adapted for a
    JSON object (`{...}`) rather than an array (`[...]`), since a rubric's
    `{"scores": {...}, "reasoning": {...}}` response is an object, not a
    list of items.
    """
    text = response_text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON object found in judge response: {text!r}")

    result = json.loads(text[start : end + 1])
    if not isinstance(result, dict):
        raise ValueError(f"Expected a JSON object from the judge, got: {type(result)}")
    return result


def judge_output(
    component: str, input_data: Any, output_data: Any, rubric_text: str
) -> dict[str, Any]:
    """Score `output_data` (produced from `input_data`) against `rubric_text`.

    `rubric_text` is the already-loaded contents of one of the files in
    `eval/rubrics/` — this function doesn't read from disk itself, so it has
    no opinion on where the rubric came from. Returns the judge's
    `{"scores": {...}, "reasoning": {...}}` dict, exactly as specified by
    the rubric's own output contract.
    """
    prompt = _JUDGE_PROMPT.format(
        rubric_text=rubric_text,
        component=component,
        input_json=json.dumps(input_data, default=str, indent=2),
        output_json=json.dumps(output_data, default=str, indent=2),
    )
    response = _anthropic().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = "".join(block.text for block in response.content if block.type == "text")
    return _extract_json_object(response_text)
