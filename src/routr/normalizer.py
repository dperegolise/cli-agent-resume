"""
normalizer.py — Normalize upstream (HuggingFace/local) responses to OpenAI completions format.
"""
import time
import uuid
from typing import Any


def normalize_completion(raw: Any, model: str, prompt: str = "") -> dict:
    """
    Convert a raw upstream response to OpenAI completions format.

    Handles:
    - HuggingFace list format: [{"generated_text": "..."}]
    - Plain string response
    - Dict with "generated_text" key
    """
    # Extract text from the raw response
    if isinstance(raw, list):
        # HuggingFace Inference API returns a list of dicts
        if len(raw) > 0:
            first = raw[0]
            if isinstance(first, dict):
                text = first.get("generated_text", "")
            else:
                text = str(first)
        else:
            text = ""
    elif isinstance(raw, dict):
        # Some providers return a single dict
        text = raw.get("generated_text", raw.get("text", raw.get("content", "")))
    elif isinstance(raw, str):
        # Plain string
        text = raw
    else:
        text = str(raw)

    return {
        "id": f"cmpl-{uuid.uuid4().hex[:24]}",
        "object": "text_completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "text": text,
                "index": 0,
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


def normalize_streaming_chunk(text: str, model: str, completion_id: str) -> dict:
    """
    Create a single SSE streaming chunk in OpenAI completions format.
    """
    return {
        "id": completion_id,
        "object": "text_completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "text": text,
                "index": 0,
                "finish_reason": None,
            }
        ],
    }
