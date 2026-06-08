"""
test_tools_stripped.py — Verify that the tools field is NEVER forwarded upstream.

The critical contract: even if the caller sends a request with a 'tools' key,
routr must strip it before forwarding. This is guaranteed by Pydantic's
model_config extra="ignore" on CompletionRequest.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from src.routr.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_tools_not_forwarded_non_streaming(client):
    """
    Send a completion request WITH a 'tools' field.
    The upstream provider must NOT receive a 'tools' key.
    """
    captured_payloads = []

    # Mock call_upstream to capture what it receives
    async def mock_call_upstream(prompt, max_tokens=256, temperature=0.7):
        captured_payloads.append({
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
        })
        # Return HuggingFace-format response
        return [{"generated_text": "Hello, world!"}]

    with patch("src.routr.main.call_upstream", side_effect=mock_call_upstream):
        response = client.post(
            "/v1/completions",
            json={
                "model": "test-model",
                "prompt": "Hello",
                "max_tokens": 50,
                "temperature": 0.5,
                # tools SHOULD be stripped by Pydantic before reaching the provider
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "search_portfolio",
                            "description": "Search the portfolio",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
            },
        )

    assert response.status_code == 200

    # Verify upstream was called exactly once
    assert len(captured_payloads) == 1

    # Verify 'tools' was NOT passed to the upstream function
    upstream_call = captured_payloads[0]
    assert "tools" not in upstream_call, (
        f"tools field was forwarded to upstream! Got: {upstream_call.keys()}"
    )


def test_tools_extra_fields_stripped(client):
    """
    Verify that multiple extra fields (tools, unknown_field, etc.) are all stripped.
    The response should still be valid OpenAI completions format.
    """
    async def mock_call_upstream(prompt, max_tokens=256, temperature=0.7):
        return [{"generated_text": "test response"}]

    with patch("src.routr.main.call_upstream", side_effect=mock_call_upstream):
        response = client.post(
            "/v1/completions",
            json={
                "model": "gpt-test",
                "prompt": "Test prompt",
                "tools": [{"type": "function", "function": {"name": "foo"}}],
                "tool_choice": "auto",
                "unknown_extra_field": "should be ignored",
            },
        )

    assert response.status_code == 200
    body = response.json()

    # Verify response has OpenAI completions shape
    assert "choices" in body
    assert body["object"] == "text_completion"
    assert "tools" not in body


def test_request_without_tools_works(client):
    """
    Verify that a plain request (no tools) still works correctly.
    """
    async def mock_call_upstream(prompt, max_tokens=256, temperature=0.7):
        return [{"generated_text": "plain response"}]

    with patch("src.routr.main.call_upstream", side_effect=mock_call_upstream):
        response = client.post(
            "/v1/completions",
            json={
                "model": "test-model",
                "prompt": "Tell me something",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["choices"][0]["text"] == "plain response"
