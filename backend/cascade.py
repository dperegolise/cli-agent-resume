"""
Model cascade: OpenRouter (free) → HuggingFace (free) → routr.

Strategy §9:
  - OpenRouter and HuggingFace receive full tool definitions.
  - routr NEVER receives tool definitions (text-only completions proxy).

Free-tier model defaults:
  - OpenRouter: meta-llama/llama-3.1-8b-instruct:free with
    google/gemma-2-9b-it:free and mistralai/mistral-7b-instruct:free as
    secondary fallbacks (tried in order before escalating to HuggingFace).
  - HuggingFace: microsoft/Phi-3-mini-4k-instruct (free serverless inference).

Fast-failure: each HTTP call uses a short connect timeout (5 s) + read timeout
(25 s) so a hung provider is detected within ~5 s rather than the full 30 s.
The cascade tries each provider in order; the first to succeed wins.
Raises RuntimeError if all providers fail.
"""

from __future__ import annotations

import logging
import os
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class Provider(str, Enum):
    OPENROUTER = "openrouter"
    HUGGINGFACE = "huggingface"
    ROUTR = "routr"


# ── Configuration helpers ─────────────────────────────────────────────────────

# Short connect timeout so a dead provider fails fast; generous read timeout for
# slow free-tier inference.
_TIMEOUT = httpx.Timeout(connect=5.0, read=25.0, write=10.0, pool=5.0)


def _openrouter_key() -> Optional[str]:
    return os.getenv("OPENROUTER_API_KEY")


def _openrouter_models() -> List[str]:
    raw = os.getenv(
        "OPENROUTER_MODELS",
        # Free tier first (no cost, 429-tolerant via fallback).
        # Paid fallback (~$0.02/M) activates when free models are rate-limited.
        # Verified live 2026-06-08; override via OPENROUTER_MODELS env var.
        "openai/gpt-oss-120b:free,"
        "google/gemma-4-31b-it:free,"
        "openai/gpt-oss-20b:free,"
        "meta-llama/llama-3.1-8b-instruct,"
        "mistralai/mistral-nemo",
    )
    return [m.strip() for m in raw.split(",") if m.strip()]


def _hf_key() -> Optional[str]:
    return os.getenv("HF_API_KEY") or os.getenv("HUGGINGFACE_API_KEY")


def _hf_models() -> List[str]:
    raw = os.getenv(
        "HF_MODELS",
        os.getenv("HUGGINGFACE_MODEL", "microsoft/Phi-3-mini-4k-instruct"),
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
            # routr's JSON API lives under /api/* — /health (no prefix) falls
            # through to the embedded SPA and returns HTML 200, which would make
            # this check pass for the wrong reason. Use the real API endpoint.
            resp = await client.get(f"{url}/api/health")
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
    skip: int = 0,
) -> Dict[str, Any]:
    """
    POST to OpenRouter, trying each model in _openrouter_models() order.
    Returns the first successful parsed JSON response body (with _provider/_model injected).
    Raises the last exception if all models fail.
    skip: number of leading models to skip (for /model advancement).
    """
    key = _openrouter_key()
    models = _openrouter_models()[skip:]
    last_exc: Exception = RuntimeError("no OpenRouter models configured")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for model in models:
            payload: Dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2048,
            }
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = "auto"

            try:
                resp = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {key}",
                        "HTTP-Referer": "https://portfolio.example.com",  # TODO: update to your deployed domain (helps OpenRouter grant higher rate limits)
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                # OpenRouter surfaces model-level errors in the JSON body even
                # on a 200 — detect and skip to the next model.
                if "error" in data:
                    err_msg = data["error"].get("message", str(data["error"]))
                    logger.warning("cascade: OpenRouter model %s error: %s", model, err_msg)
                    last_exc = RuntimeError(f"{model}: {err_msg}")
                    continue
                logger.info("cascade: OpenRouter model %s succeeded", model)
                data["_provider"] = "OpenRouter"
                data["_model"] = model
                return data
            except Exception as exc:
                logger.warning("cascade: OpenRouter model %s failed: %s", model, exc)
                last_exc = exc

    raise last_exc


async def _call_huggingface(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    POST to HuggingFace Serverless Inference API (chat-completions format).
    Tries each model in _hf_models() order; raises last exception if all fail.
    Note: free-tier models may not support tool_choice — tools are omitted if
    the model returns a 422/400 indicating unsupported parameters.
    Returns response with _provider/_model injected.
    """
    key = _hf_key()
    models = _hf_models()
    last_exc: Exception = RuntimeError("no HuggingFace models configured")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for model in models:
            payload: Dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2048,
            }
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = "auto"

            try:
                resp = await client.post(
                    f"https://api-inference.huggingface.co/models/{model}/v1/chat/completions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                )
                # 422/400 with tools may mean model doesn't support them — retry
                # without tools before giving up on this model.
                if resp.status_code in (400, 422) and tools:
                    logger.warning(
                        "cascade: HF model %s rejected tools (%s), retrying without",
                        model, resp.status_code,
                    )
                    payload.pop("tools", None)
                    payload.pop("tool_choice", None)
                    resp = await client.post(
                        f"https://api-inference.huggingface.co/models/{model}/v1/chat/completions",
                        json=payload,
                        headers={
                            "Authorization": f"Bearer {key}",
                            "Content-Type": "application/json",
                        },
                    )
                resp.raise_for_status()
                logger.info("cascade: HuggingFace model %s succeeded", model)
                data = resp.json()
                data["_provider"] = "HuggingFace"
                data["_model"] = model
                return data
            except Exception as exc:
                logger.warning("cascade: HuggingFace model %s failed: %s", model, exc)
                last_exc = exc

    raise last_exc


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

    # Build payload explicitly — no 'tools' key at all.
    # Deliberately NO 'model' field: routr resolves its default route (the
    # configured cascade) when model is omitted. Sending a literal like "local"
    # makes routr try to look up a model named "local" and 502 with
    # "model 'local' does not exist".
    payload: Dict[str, Any] = {
        "prompt": prompt,
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    # Sanity guard: assert the payload we are about to send has no tools key
    assert "tools" not in payload, "tools must not appear in the routr payload"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # routr's native cascade endpoint is POST /api/completions (not the
        # OpenAI-style /v1/completions, which doesn't exist and falls through to
        # the SPA, returning HTML → JSON-decode error). Request shape
        # {prompt, max_tokens, temperature} matches models.CompletionRequest.
        resp = await client.post(
            f"{url}/api/completions",
            json=payload,
        )
        resp.raise_for_status()
        raw = resp.json()

    # routr's CompletionResponse is flat: {"text", "model", "provider", ...} —
    # not an OpenAI choices[] envelope. Read the top-level "text".
    text = raw.get("text", "")
    if not text and isinstance(raw.get("choices"), list) and raw["choices"]:
        # Defensive fallback for any OpenAI-compat shape.
        choice = raw["choices"][0]
        text = choice.get("text", "") or choice.get("message", {}).get("content", "")

    return {
        "_provider": "routr",
        "_model": raw.get("model", "local"),
        "choices": [
            {
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ]
    }


# ── Public cascade entrypoint ─────────────────────────────────────────────────

def openrouter_model_count() -> int:
    """Return the total number of configured OpenRouter models."""
    return len(_openrouter_models())


async def call_with_cascade(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
    openrouter_skip: int = 0,
) -> Dict[str, Any]:
    """
    Try providers in order (OpenRouter → HuggingFace → routr).

    openrouter_skip: skip the first N OpenRouter models (for /model advancement).
    For routr: tools are explicitly stripped before the HTTP call.
    Raises RuntimeError if all providers fail.
    """
    errors: List[str] = []

    # ── Tier 1: OpenRouter ────────────────────────────────────────────────────
    if await _openrouter_available():
        try:
            logger.info("cascade: trying OpenRouter (skip=%d)", openrouter_skip)
            return await _call_openrouter(messages, tools, skip=openrouter_skip)
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
