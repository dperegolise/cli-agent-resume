"""
Model cascade: OpenRouter → HuggingFace → src/routr.

Strategy §9:
  - OpenRouter and HuggingFace receive full tool definitions.
  - routr NEVER receives tool definitions (text-only completions proxy).

The cascade tries each provider in order; the first to succeed wins.
Raises RuntimeError if all providers fail.
"""

from __future__ import annotations

import json
import logging
import os
from enum import Enum
from typing import Any, Dict, List, Optional, AsyncGenerator

import httpx

logger = logging.getLogger(__name__)


class Provider(str, Enum):
    OPENROUTER = "openrouter"
    HUGGINGFACE = "huggingface"
    ROUTR = "routr"


# ── Configuration helpers ─────────────────────────────────────────────────────

def _openrouter_key() -> Optional[str]:
    return os.getenv("OPENROUTER_API_KEY")


def _openrouter_models() -> List[str]:
    raw = os.getenv("OPENROUTER_MODELS", "openai/gpt-4o-mini")
    return [m.strip() for m in raw.split(",") if m.strip()]


def _hf_key() -> Optional[str]:
    return os.getenv("HF_API_KEY") or os.getenv("HUGGINGFACE_API_KEY")


def _hf_models() -> List[str]:
    raw = os.getenv(
        "HF_MODELS",
        os.getenv("HUGGINGFACE_MODEL", "mistralai/Mistral-7B-Instruct-v0.1"),
    )
    return [m.strip() for m in raw.split(",") if m.strip()]


def _routr_url() -> str:
    return os.getenv("ROUTR_URL", "http://localhost:8000")


# ── Health checks ─────────────────────────────────────────────────────────────

async def _openrouter_available() -> bool:
    return bool(_openrouter_key())


async def _hf_available() -> bool:
    return bool(_hf_key())


async def _routr_available() -> bool:
    url = _routr_url()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{url}/health")
            return resp.status_code == 200
    except Exception:
        return False


# ── Low-level HTTP helpers ────────────────────────────────────────────────────

def _messages_to_prompt(messages: List[Dict[str, str]]) -> str:
    """Convert chat messages array to a simple text prompt for completions APIs."""
    parts: List[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"[System]: {content}")
        elif role == "assistant":
            parts.append(f"Assistant: {content}")
        else:
            parts.append(f"User: {content}")
    parts.append("Assistant:")
    return "\n".join(parts)


async def _call_openrouter(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """POST to OpenRouter; returns the parsed JSON response body."""
    key = _openrouter_key()
    models = _openrouter_models()

    payload: Dict[str, Any] = {
        "model": models[0],
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {key}",
                "HTTP-Referer": "https://portfolio.example.com",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _call_huggingface(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """POST to HuggingFace Inference API (chat-completions format); returns parsed JSON."""
    key = _hf_key()
    models = _hf_models()
    model = models[0]

    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"https://api-inference.huggingface.co/models/{model}/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _call_routr(
    messages: List[Dict[str, Any]],
    tools: None,
) -> Dict[str, Any]:
    """
    POST to routr /v1/completions.

    CRITICAL: *tools* MUST be None here — routr is text-only and must never
    receive tool definitions.  This is enforced with a hard assertion.
    """
    assert tools is None, (
        "routr is a text-only completions proxy; tool definitions must NOT be passed to it."
    )

    url = _routr_url()
    prompt = _messages_to_prompt(messages)

    # Build payload explicitly — no 'tools' key at all
    payload: Dict[str, Any] = {
        "model": "local",
        "prompt": prompt,
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    # Sanity guard: assert the payload we are about to send has no tools key
    assert "tools" not in payload, "tools must not appear in the routr payload"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{url}/v1/completions",
            json=payload,
        )
        resp.raise_for_status()
        raw = resp.json()

    # Normalise to chat-completions shape so the caller has a uniform interface
    text = ""
    if "choices" in raw and raw["choices"]:
        choice = raw["choices"][0]
        text = choice.get("text", "") or choice.get("message", {}).get("content", "")

    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": text},
                "finish_reason": raw.get("choices", [{}])[0].get(
                    "finish_reason", "stop"
                ),
            }
        ]
    }


# ── Public cascade entrypoint ─────────────────────────────────────────────────

async def call_with_cascade(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    Try providers in order (OpenRouter → HuggingFace → routr).

    For routr: tools are explicitly stripped before the HTTP call.
    Raises RuntimeError if all providers fail.
    """
    errors: List[str] = []

    # ── Tier 1: OpenRouter ────────────────────────────────────────────────────
    if await _openrouter_available():
        try:
            logger.info("cascade: trying OpenRouter")
            return await _call_openrouter(messages, tools)
        except Exception as exc:
            logger.warning("cascade: OpenRouter failed: %s", exc)
            errors.append(f"OpenRouter: {exc}")

    # ── Tier 2: HuggingFace ───────────────────────────────────────────────────
    if await _hf_available():
        try:
            logger.info("cascade: trying HuggingFace")
            return await _call_huggingface(messages, tools)
        except Exception as exc:
            logger.warning("cascade: HuggingFace failed: %s", exc)
            errors.append(f"HuggingFace: {exc}")

    # ── Tier 3: routr ─────────────────────────────────────────────────────────
    if await _routr_available():
        try:
            logger.info("cascade: trying routr (no tools)")
            # NEVER pass tools to routr — pass None explicitly
            return await _call_routr(messages, tools=None)
        except Exception as exc:
            logger.warning("cascade: routr failed: %s", exc)
            errors.append(f"routr: {exc}")

    raise RuntimeError(
        "All model providers failed: " + "; ".join(errors) if errors else "No providers available"
    )
