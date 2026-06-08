"""
providers.py — Upstream provider client for routr.

Reads ROUTR_MODEL_URL and ROUTR_MODEL_NAME from env.
Supports both streaming and non-streaming HuggingFace Inference API calls.
"""
import os
from typing import AsyncIterator, Union

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL_NAME = "mistralai/Mistral-7B-Instruct-v0.2"
DEFAULT_MODEL_URL = (
    "https://api-inference.huggingface.co/models/"
    + DEFAULT_MODEL_NAME
)


def get_model_url() -> str:
    """Return the upstream model endpoint URL from env or default."""
    return os.getenv("ROUTR_MODEL_URL", DEFAULT_MODEL_URL)


def get_model_name() -> str:
    """Return the model name from env or default."""
    return os.getenv("ROUTR_MODEL_NAME", DEFAULT_MODEL_NAME)


def _build_hf_payload(prompt: Union[str, list], max_tokens: int, temperature: float) -> dict:
    """
    Build HuggingFace Inference API request payload.
    NOTE: tools are NEVER included here — routr is text-only.
    """
    # If prompt is a list, join into a single string
    if isinstance(prompt, list):
        combined = "\n".join(str(p) for p in prompt)
    else:
        combined = str(prompt)

    return {
        "inputs": combined,
        "parameters": {
            "max_new_tokens": max_tokens,
            "temperature": temperature,
            "return_full_text": False,
        },
    }


async def call_upstream(
    prompt: Union[str, list],
    max_tokens: int = 256,
    temperature: float = 0.7,
) -> list:
    """
    Make a non-streaming call to the upstream model.

    Returns the raw JSON response (list for HuggingFace, varies for local).
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    url = get_model_url()
    payload = _build_hf_payload(prompt, max_tokens, temperature)

    hf_key = os.getenv("HUGGINGFACE_API_KEY", "")
    headers = {}
    if hf_key:
        headers["Authorization"] = f"Bearer {hf_key}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()


async def stream_upstream(
    prompt: Union[str, list],
    max_tokens: int = 256,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """
    Make a streaming call to the upstream model.

    Yields text chunks as they arrive from the upstream.
    For HuggingFace (which doesn't always support true streaming), falls back
    to a single-chunk yield from the non-streaming response.
    """
    # HuggingFace Inference API supports streaming via stream=True param
    url = get_model_url()
    payload = _build_hf_payload(prompt, max_tokens, temperature)
    # Enable streaming if the endpoint supports it
    payload["stream"] = True

    hf_key = os.getenv("HUGGINGFACE_API_KEY", "")
    headers = {}
    if hf_key:
        headers["Authorization"] = f"Bearer {hf_key}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            async with client.stream(
                "POST", url, json=payload, headers=headers
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    # HuggingFace streaming lines are plain text tokens
                    # or SSE-format "data: ..." lines
                    if line.startswith("data:"):
                        chunk = line[5:].strip()
                        if chunk and chunk != "[DONE]":
                            yield chunk
                    else:
                        yield line
        except httpx.HTTPStatusError:
            # Fallback: try non-streaming
            result = await call_upstream(prompt, max_tokens, temperature)
            # Extract text from result
            if isinstance(result, list) and result:
                first = result[0]
                if isinstance(first, dict):
                    yield first.get("generated_text", "")
                else:
                    yield str(first)
            elif isinstance(result, dict):
                yield result.get("generated_text", result.get("text", ""))
