"""
Tests for cascade.py — routr tier NEVER receives tool definitions.

Strategy §9: "Tools are never sent to src/routr."

The test mocks the HTTP client so no real network calls are made.
It drives the cascade so that OpenRouter and HuggingFace both fail,
forcing a fall-through to the routr tier, then asserts the HTTP
payload sent to routr contains NO 'tools' key.

Also tests the SSE stream endpoint: strategy §5 specifies that the
"done" event must be sent exactly once per stream, regardless of path.
"""

import sys
import os
import json
from typing import AsyncIterator, Dict, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cascade as cascade_module


# ── Helpers ────────────────────────────────────────────────────────────────────

SAMPLE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_portfolio",
            "description": "Search portfolio",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "focus_item",
            "description": "Focus a file",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]

SAMPLE_MESSAGES = [
    {"role": "system", "content": "You are a portfolio agent."},
    {"role": "user", "content": "Tell me about the projects."},
]

ROUTR_SUCCESS_RESPONSE = {
    "choices": [
        {
            "text": "Here are the projects!",
            "finish_reason": "stop",
        }
    ]
}


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_routr_never_receives_tools_when_others_fail():
    """
    When OpenRouter and HuggingFace fail, cascade falls through to routr.
    The HTTP POST body to routr must NOT contain a 'tools' key.
    """
    captured_bodies = []

    # Build a mock async response for routr
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = MagicMock(return_value=ROUTR_SUCCESS_RESPONSE)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _mock_post(url, json=None, headers=None, **kwargs):
        if json is not None:
            captured_bodies.append({"url": url, "body": dict(json)})
        return mock_response

    mock_client.post = _mock_post

    with (
        # OpenRouter: key absent → falls through (no HTTP call)
        patch.dict(os.environ, {"OPENROUTER_API_KEY": "", "HF_API_KEY": "", "HUGGINGFACE_API_KEY": ""}),
        # Routr health check returns True
        patch.object(cascade_module, "_routr_available", AsyncMock(return_value=True)),
        # Inject our mock HTTP client for the routr POST
        patch("cascade.httpx.AsyncClient", return_value=mock_client),
    ):
        result = await cascade_module.call_with_cascade(SAMPLE_MESSAGES, SAMPLE_TOOLS)

    # At least one call should have hit the routr URL
    routr_calls = [c for c in captured_bodies if "/v1/completions" in c["url"]]
    assert routr_calls, "Expected at least one POST to /v1/completions (routr)"

    for call in routr_calls:
        body = call["body"]
        assert "tools" not in body, (
            f"routr payload must NOT contain 'tools', but got keys: {list(body.keys())}"
        )


@pytest.mark.asyncio
async def test_routr_payload_has_no_tools_key_direct():
    """
    Call _call_routr directly and assert the assertion fires if tools is non-None,
    and passes cleanly when tools=None.
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = MagicMock(return_value=ROUTR_SUCCESS_RESPONSE)

    captured = {}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _mock_post(url, json=None, **kwargs):
        captured["body"] = dict(json) if json is not None else {}
        return mock_response

    mock_client.post = _mock_post

    with patch("cascade.httpx.AsyncClient", return_value=mock_client):
        await cascade_module._call_routr(SAMPLE_MESSAGES, tools=None)

    body = captured.get("body", {})
    assert "tools" not in body, (
        f"_call_routr must never include 'tools' in the payload; got keys: {list(body.keys())}"
    )


@pytest.mark.asyncio
async def test_routr_assertion_fires_when_tools_passed():
    """
    Calling _call_routr with non-None tools must raise AssertionError.
    This enforces the hard constraint at the code level.
    """
    with pytest.raises(AssertionError):
        await cascade_module._call_routr(SAMPLE_MESSAGES, tools=SAMPLE_TOOLS)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_openrouter_receives_tools_when_available():
    """
    When OpenRouter is available, the payload SHOULD include the tools key.
    """
    captured = {}

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = MagicMock(return_value={
        "choices": [{"message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}]
    })

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _mock_post(url, json=None, headers=None, **kwargs):
        captured["body"] = dict(json) if json is not None else {}
        return mock_response

    mock_client.post = _mock_post

    with (
        patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-test-key"}),
        patch("cascade.httpx.AsyncClient", return_value=mock_client),
    ):
        await cascade_module._call_openrouter(SAMPLE_MESSAGES, SAMPLE_TOOLS)

    body = captured.get("body", {})
    assert "tools" in body, "OpenRouter payload should include 'tools'"
    assert body["tools"] == SAMPLE_TOOLS


# ── SSE stream: exactly-one-done tests ───────────────────────────────────────

def _parse_sse_events(raw: str):
    """Parse raw SSE body into a list of event dicts."""
    events = []
    for chunk in raw.strip().split("\n\n"):
        for line in chunk.splitlines():
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
    return events


def test_done_event_emitted_exactly_once_on_happy_path():
    """
    Strategy §5: the 'done' SSE event must be sent EXACTLY ONCE per stream.

    On the happy path run_agent yields [token, done]. The _stream() finally block
    must NOT emit a second done event, even though Python async generators still
    execute finally on a clean return.
    """
    import rate_limiter
    import manifest as manifest_module
    from fastapi.testclient import TestClient
    from main import app

    rate_limiter.reset_state()

    # Minimal manifest so the agent can start
    manifest_module._entries.clear()
    manifest_module._contents.clear()
    manifest_module._loaded = True

    async def _fake_run_agent(messages, session_id):
        yield {"type": "token", "content": "hi"}
        yield {"type": "done"}

    client = TestClient(app, raise_server_exceptions=False)
    with patch("main.run_agent", _fake_run_agent):
        resp = client.post(
            "/agent",
            json={
                "messages": [{"role": "user", "content": "hello"}],
                "session_id": "exactly-one-done-test",
            },
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    events = _parse_sse_events(resp.text)
    done_events = [e for e in events if e.get("type") == "done"]
    assert len(done_events) == 1, (
        f"Expected exactly 1 'done' event, got {len(done_events)}: {events}"
    )
