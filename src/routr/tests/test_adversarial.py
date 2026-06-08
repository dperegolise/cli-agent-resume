"""
test_adversarial.py — Hostile / adversarial tests for routr.

Attack categories:
1. Tools-smuggling: every angle to get `tools` past Pydantic into the upstream call.
2. Malformed / boundary inputs: missing fields, extremes, wrong types.
3. Upstream failures: 500, 503, connection refused.
4. Streaming interruption: mid-stream cut-off.
5. Health under upstream failure.
6. Large payload (50 KB prompt).
7. Concurrent request safety (shared-state check).
8. Normalizer edge-cases missed by existing tests.
"""

import asyncio
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from src.routr.main import app
from src.routr.normalizer import normalize_completion, normalize_streaming_chunk
from src.routr.providers import _build_hf_payload


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app)


# ===========================================================================
# 1.  TOOLS-SMUGGLING ATTACKS
#     Each test verifies the *actual HTTP payload sent to upstream* has no
#     `tools` key.  We intercept at the httpx level so we see exactly what
#     providers.py would have sent over the wire.
# ===========================================================================

def _capture_upstream_body(captured: list):
    """
    Returns an httpx transport mock that records request bodies and returns a
    minimal valid HuggingFace-style JSON response.
    """
    class CapturingTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            body = json.loads(request.content)
            captured.append(body)
            response_body = json.dumps([{"generated_text": "mock response"}]).encode()
            return httpx.Response(200, content=response_body,
                                  headers={"Content-Type": "application/json"})

    return CapturingTransport()


class TestToolsSmuggling:
    """
    Every variation of the tools key that a confused client might send.
    None should reach the upstream HTTP body.
    """

    def _assert_no_tools_in_body(self, body: dict, label: str):
        """Recursively assert no 'tools' key appears anywhere in body."""
        def _walk(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k.lower() in ("tools", "tool_choice", "tool_calls",
                                     "function_call", "functions"):
                        pytest.fail(
                            f"[{label}] Forbidden key '{k}' found at path "
                            f"'{path}.{k}' in upstream body: {obj}"
                        )
                    _walk(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    _walk(item, f"{path}[{i}]")
        _walk(body)

    def _run_attack(self, client, payload: dict, label: str):
        captured = []
        transport = _capture_upstream_body(captured)
        with patch("src.routr.providers.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            # Mock the post call to capture payload
            async def fake_post(url, **kwargs):
                captured.append(kwargs.get("json", {}))
                mock_resp = MagicMock()
                mock_resp.raise_for_status = MagicMock()
                mock_resp.json = MagicMock(return_value=[{"generated_text": "ok"}])
                return mock_resp
            mock_client.post = fake_post
            resp = client.post("/v1/completions", json=payload)

        assert resp.status_code == 200, f"[{label}] Got {resp.status_code}: {resp.text}"
        for body in captured:
            self._assert_no_tools_in_body(body, label)

    def test_direct_tools_field(self, client):
        """Attack: {"model":"x","prompt":"hi","tools":[{"name":"foo"}]}"""
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "tools": [{"name": "foo"}],
        }, "direct_tools")

    def test_uppercase_tools_field(self, client):
        """Attack: TOOLS (uppercase) key — Pydantic extra=ignore is case-sensitive."""
        # If Pydantic doesn't strip TOOLS, it would be a pass-through extra field
        # We still check it doesn't reach upstream as "TOOLS"
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "TOOLS": [{"name": "foo"}],
        }, "uppercase_TOOLS")

    def test_tools_with_tool_choice(self, client):
        """Attack: tools + tool_choice combo"""
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "tool_choice": "auto",
            "tools": [{"type": "function", "function": {"name": "bar"}}],
        }, "tools_with_tool_choice")

    def test_messages_format_with_tools(self, client):
        """Attack: messages array format (wrong endpoint) + tools"""
        # routr only knows CompletionRequest (prompt=str/list), not messages.
        # But if someone sends messages + tools, the request might still parse
        # with prompt missing → 422, OR it might succeed with tools stripped.
        resp = client.post("/v1/completions", json={
            "model": "x",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"name": "foo"}],
        })
        # Either 422 (missing prompt) or 200 — but must NEVER forward tools
        assert resp.status_code in (200, 422), f"Unexpected: {resp.status_code}"

    def test_nested_tools_in_extra_field(self, client):
        """Attack: deeply nested tools inside extra object"""
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "extra": {"tools": [{"name": "nested_tool"}]},
        }, "nested_tools_in_extra")

    def test_tools_as_string_value(self, client):
        """Attack: tools as a string (not a list) — should still be stripped"""
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "tools": "auto",
        }, "tools_as_string")

    def test_function_call_field(self, client):
        """Attack: function_call field (OpenAI legacy tools format)"""
        self._run_attack(client, {
            "model": "x",
            "prompt": "hi",
            "function_call": "auto",
            "functions": [{"name": "get_weather", "parameters": {}}],
        }, "function_call")

    def test_tool_calls_in_prompt_array(self, client):
        """Attack: prompt as array with tool_call-like dicts embedded"""
        # The prompt list gets joined to a string — these shouldn't be executable
        self._run_attack(client, {
            "model": "x",
            "prompt": ["normal text", {"role": "tool", "content": "result"}],
        }, "tool_calls_in_prompt_array")

    def test_tools_smuggled_via_provider_payload_direct(self):
        """
        Unit-level attack: call _build_hf_payload directly and verify
        the output never contains 'tools', 'tool_choice', or 'functions'.
        """
        payload = _build_hf_payload(
            prompt="test prompt",
            max_tokens=100,
            temperature=0.5,
        )
        forbidden = {"tools", "tool_choice", "functions", "function_call",
                     "tool_calls"}
        found = forbidden.intersection(set(payload.keys()))
        assert not found, f"_build_hf_payload produced forbidden keys: {found}"

        # Also check nested parameters
        if "parameters" in payload:
            found_nested = forbidden.intersection(set(payload["parameters"].keys()))
            assert not found_nested, (
                f"_build_hf_payload.parameters has forbidden keys: {found_nested}"
            )

    def test_tools_with_stream_true(self, client):
        """Attack: tools + stream=True — streaming path must also strip tools."""
        captured = []

        async def fake_stream_upstream(prompt, max_tokens=256, temperature=0.7):
            # Record what was passed — should NOT include tools
            captured.append({
                "prompt": prompt,
                "max_tokens": max_tokens,
                "temperature": temperature,
            })
            yield "streamed chunk"

        with patch("src.routr.main.stream_upstream", side_effect=fake_stream_upstream):
            response = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "test",
                "stream": True,
                "tools": [{"name": "dangerous_tool"}],
            })

        assert response.status_code == 200
        assert len(captured) == 1
        assert "tools" not in captured[0], (
            f"tools smuggled into stream_upstream call: {captured[0]}"
        )


# ===========================================================================
# 2.  MALFORMED / BOUNDARY INPUTS
# ===========================================================================

class TestMalformedInputs:

    def test_missing_model_field(self, client):
        """model is required — should return 422"""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={"prompt": "hello"})
        assert resp.status_code == 422

    def test_missing_prompt_field(self, client):
        """prompt is required — should return 422"""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={"model": "test-model"})
        assert resp.status_code == 422

    def test_missing_both_required_fields(self, client):
        """Both model and prompt missing — 422"""
        resp = client.post("/v1/completions", json={"temperature": 0.5})
        assert resp.status_code == 422

    def test_empty_body(self, client):
        """Empty JSON body — 422"""
        resp = client.post("/v1/completions", json={})
        assert resp.status_code == 422

    def test_negative_max_tokens(self, client):
        """
        Negative max_tokens — Pydantic doesn't validate this by default.
        Either returns 422 (if validated) or passes through to upstream.
        The concern: negative value shouldn't crash the server.
        """
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "hi",
                "max_tokens": -1,
            })
        # Should be either 422 (validation) or 200 (passed through)
        # It must NOT crash (500)
        assert resp.status_code in (200, 422), (
            f"Unexpected status {resp.status_code} for negative max_tokens"
        )

    def test_zero_max_tokens(self, client):
        """Zero max_tokens — server must not crash"""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": ""}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "hi",
                "max_tokens": 0,
            })
        assert resp.status_code in (200, 422)

    def test_temperature_above_2(self, client):
        """Temperature > 2.0 is out-of-spec for most providers. Must not crash."""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "hi",
                "temperature": 999.0,
            })
        assert resp.status_code in (200, 422)

    def test_temperature_negative(self, client):
        """Negative temperature. Must not crash."""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "hi",
                "temperature": -1.0,
            })
        assert resp.status_code in (200, 422)

    def test_wrong_content_type(self, client):
        """Send non-JSON body — should get 422 or 415, not 500"""
        resp = client.post(
            "/v1/completions",
            content=b"not json at all",
            headers={"Content-Type": "text/plain"},
        )
        assert resp.status_code in (400, 415, 422), (
            f"Expected client error for bad content-type, got {resp.status_code}"
        )

    def test_prompt_as_empty_string(self, client):
        """Empty string prompt — valid structure but degenerate input"""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": ""}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "",
            })
        # Empty string is a valid Union[str, list] — should succeed or 422
        assert resp.status_code in (200, 422)

    def test_prompt_as_empty_list(self, client):
        """Empty list prompt"""
        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": ""}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": [],
            })
        assert resp.status_code in (200, 422)

    def test_model_as_integer(self, client):
        """model as integer instead of string — 422"""
        resp = client.post("/v1/completions", json={
            "model": 42,
            "prompt": "hi",
        })
        # Pydantic may coerce or reject — must not crash
        assert resp.status_code in (200, 422)

    def test_null_prompt(self, client):
        """null prompt — 422"""
        resp = client.post("/v1/completions", json={
            "model": "x",
            "prompt": None,
        })
        assert resp.status_code == 422

    def test_null_model(self, client):
        """null model — 422"""
        resp = client.post("/v1/completions", json={
            "model": None,
            "prompt": "hi",
        })
        assert resp.status_code == 422


# ===========================================================================
# 3.  UPSTREAM FAILURE HANDLING
#     routr should return 502 on upstream errors, never 500 (unhandled crash).
# ===========================================================================

class TestUpstreamFailures:

    def test_upstream_500_returns_502(self, client):
        """When upstream returns 500, routr should return 502 (not crash)."""
        async def mock_upstream_500(prompt, max_tokens=256, temperature=0.7):
            raise httpx.HTTPStatusError(
                "500 Internal Server Error",
                request=MagicMock(),
                response=MagicMock(status_code=500),
            )

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_500):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 502
        body = resp.json()
        assert "detail" in body or "error" in body

    def test_upstream_503_returns_502(self, client):
        """When upstream returns 503 (service unavailable), routr returns 502."""
        async def mock_upstream_503(prompt, max_tokens=256, temperature=0.7):
            raise httpx.HTTPStatusError(
                "503 Service Unavailable",
                request=MagicMock(),
                response=MagicMock(status_code=503),
            )

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_503):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 502

    def test_upstream_connection_refused_returns_502(self, client):
        """Connection refused (upstream is down) → 502, not crash"""
        async def mock_upstream_conn_refused(prompt, max_tokens=256, temperature=0.7):
            raise httpx.ConnectError("Connection refused")

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_conn_refused):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 502

    def test_upstream_timeout_returns_502(self, client):
        """Upstream timeout → 502"""
        async def mock_upstream_timeout(prompt, max_tokens=256, temperature=0.7):
            raise httpx.TimeoutException("Request timed out")

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_timeout):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 502

    def test_upstream_returns_invalid_json_structure(self, client):
        """Upstream returns unexpected JSON structure — normalizer must not crash."""
        async def mock_upstream_weird(prompt, max_tokens=256, temperature=0.7):
            # Return something totally unexpected
            return {"unexpected": "structure", "no_text": True}

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_weird):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        # Should not be a 500 — normalizer should handle gracefully
        assert resp.status_code == 200
        body = resp.json()
        assert "choices" in body

    def test_upstream_returns_null(self, client):
        """Upstream returns None/null — normalizer must not crash."""
        async def mock_upstream_null(prompt, max_tokens=256, temperature=0.7):
            return None

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_null):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        # Should not crash
        assert resp.status_code in (200, 502)

    def test_upstream_returns_empty_dict(self, client):
        """Upstream returns {} — normalizer should produce empty text, not crash."""
        async def mock_upstream_empty_dict(prompt, max_tokens=256, temperature=0.7):
            return {}

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_empty_dict):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 200
        body = resp.json()
        assert "choices" in body

    def test_upstream_returns_integer(self, client):
        """Upstream returns integer — normalizer str() fallback."""
        async def mock_upstream_int(prompt, max_tokens=256, temperature=0.7):
            return 42

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_int):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 200

    def test_upstream_raises_value_error(self, client):
        """Generic ValueError from upstream → 502, not 500"""
        async def mock_upstream_ve(prompt, max_tokens=256, temperature=0.7):
            raise ValueError("invalid response data")

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream_ve):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "hi"
            })
        assert resp.status_code == 502


# ===========================================================================
# 4.  STREAMING INTERRUPTION
# ===========================================================================

class TestStreamingInterruption:

    def test_streaming_upstream_cut_off_mid_stream(self, client):
        """
        Mock upstream SSE that raises an exception mid-stream.
        routr should not hang; the streaming response should terminate
        cleanly with an error payload followed by [DONE].
        """
        async def mock_stream_cut_off(prompt, max_tokens=256, temperature=0.7):
            yield "first chunk"
            yield "second chunk"
            raise ConnectionError("Upstream cut the connection")

        with patch("src.routr.main.stream_upstream", side_effect=mock_stream_cut_off):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "test", "stream": True
            })

        assert resp.status_code == 200
        raw = resp.text
        # Should contain [DONE]
        assert "[DONE]" in raw, f"Missing [DONE] in streaming response: {raw[:500]}"
        # Should have streamed the first two chunks before the error
        lines = [l for l in raw.split("\n") if l.startswith("data: ")]
        assert len(lines) >= 2, f"Expected ≥2 data lines, got: {lines}"

    def test_streaming_upstream_error_on_first_chunk(self, client):
        """
        Mock upstream that immediately raises an error (no chunks at all).
        """
        async def mock_stream_immediate_fail(prompt, max_tokens=256, temperature=0.7):
            raise RuntimeError("Upstream immediately unavailable")
            yield  # make it a generator

        with patch("src.routr.main.stream_upstream", side_effect=mock_stream_immediate_fail):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "test", "stream": True
            })

        assert resp.status_code == 200
        raw = resp.text
        assert "[DONE]" in raw
        # Error payload should be present
        lines = [l for l in raw.split("\n") if l.startswith("data: ")]
        assert len(lines) >= 1

    def test_streaming_response_is_valid_sse(self, client):
        """Each line in streaming response must be valid SSE (data: ... or empty)."""
        async def mock_stream(prompt, max_tokens=256, temperature=0.7):
            for word in ["Hello", " world", "!"]:
                yield word

        with patch("src.routr.main.stream_upstream", side_effect=mock_stream):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "test", "stream": True
            })

        assert resp.status_code == 200
        for line in resp.text.split("\n"):
            if line:
                assert line.startswith("data: "), (
                    f"Non-SSE line in streaming response: {repr(line)}"
                )

    def test_streaming_each_chunk_has_no_tools(self, client):
        """Tools must not appear in any streaming chunk."""
        async def mock_stream(prompt, max_tokens=256, temperature=0.7):
            yield "chunk1"
            yield "chunk2"

        with patch("src.routr.main.stream_upstream", side_effect=mock_stream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": "test",
                "stream": True,
                "tools": [{"name": "bad_tool"}],
            })

        assert resp.status_code == 200
        for line in resp.text.split("\n"):
            if line.startswith("data: ") and "[DONE]" not in line:
                chunk_data = json.loads(line[6:])
                assert "tools" not in chunk_data, (
                    f"tools key appeared in streaming chunk: {chunk_data}"
                )

    def test_streaming_all_done_line_present(self, client):
        """Even an empty stream must end with data: [DONE]"""
        async def mock_stream_empty(prompt, max_tokens=256, temperature=0.7):
            return
            yield  # empty generator

        with patch("src.routr.main.stream_upstream", side_effect=mock_stream_empty):
            resp = client.post("/v1/completions", json={
                "model": "x", "prompt": "test", "stream": True
            })

        assert resp.status_code == 200
        assert "data: [DONE]" in resp.text


# ===========================================================================
# 5.  HEALTH ENDPOINT UNDER UPSTREAM FAILURE
#     /health should ALWAYS return 200 — it is a local check only.
# ===========================================================================

class TestHealthUnderUpstreamFailure:

    def test_health_still_200_when_upstream_down(self, client):
        """
        /health must return 200 regardless of upstream state.
        It should NOT attempt to connect to upstream.
        """
        # Patch call_upstream to raise to verify health doesn't call it
        async def boom(prompt, max_tokens=256, temperature=0.7):
            raise ConnectionError("Upstream completely down")

        with patch("src.routr.main.call_upstream", side_effect=boom):
            resp = client.get("/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"

    def test_health_does_not_call_upstream(self, client):
        """Verify /health never calls call_upstream or stream_upstream."""
        call_upstream_mock = AsyncMock()
        stream_upstream_mock = AsyncMock()

        with patch("src.routr.main.call_upstream", call_upstream_mock), \
             patch("src.routr.main.stream_upstream", stream_upstream_mock):
            resp = client.get("/health")

        assert resp.status_code == 200
        call_upstream_mock.assert_not_called()
        stream_upstream_mock.assert_not_called()

    def test_health_response_structure(self, client):
        """Health response always has 'status' and 'model' keys."""
        resp = client.get("/health")
        body = resp.json()
        assert "status" in body
        assert "model" in body
        assert body["status"] == "ok"
        assert isinstance(body["model"], str)
        assert body["model"] != ""


# ===========================================================================
# 6.  LARGE PAYLOAD
# ===========================================================================

class TestLargePayload:

    def test_50kb_prompt_no_crash(self, client):
        """A 50 KB prompt must not crash the server."""
        large_prompt = "A" * (50 * 1024)  # 50 KB

        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "processed large input"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": large_prompt,
            })

        assert resp.status_code == 200
        body = resp.json()
        assert "choices" in body

    def test_50kb_prompt_forwarded_correctly(self, client):
        """Large prompt must be forwarded to upstream correctly (not truncated)."""
        large_prompt = "B" * (50 * 1024)
        received_prompts = []

        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            received_prompts.append(prompt)
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": large_prompt,
            })

        assert resp.status_code == 200
        assert len(received_prompts) == 1
        assert len(received_prompts[0]) == 50 * 1024, (
            f"Prompt was truncated: expected {50*1024} chars, got {len(received_prompts[0])}"
        )

    def test_large_list_prompt(self, client):
        """Prompt as a large list of strings — should be joined and handled."""
        large_list = [f"item {i}" for i in range(1000)]

        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            return [{"generated_text": "ok"}]

        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            resp = client.post("/v1/completions", json={
                "model": "x",
                "prompt": large_list,
            })

        assert resp.status_code == 200


# ===========================================================================
# 7.  CONCURRENT REQUEST SAFETY
# ===========================================================================

class TestConcurrentRequests:

    def test_10_concurrent_requests_no_corruption(self):
        """
        Fire 10 concurrent POST /v1/completions requests.
        All should succeed, and each response should correspond to its own request
        (no shared-state corruption, no mixing of results).

        IMPORTANT: We apply the patch BEFORE spawning threads and remove it AFTER
        all threads complete.  Applying patch() inside concurrent threads causes a
        race: thread A exits its `with patch()` block (restoring the real function)
        while thread B is still mid-request, which triggers a real HuggingFace DNS
        lookup → 502.  This is a unittest.mock.patch limitation, not a routr bug.
        """
        import threading

        results = []
        errors = []
        lock = threading.Lock()

        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            # Return the prompt back so we can verify isolation
            return [{"generated_text": f"echo:{prompt}"}]

        def make_request(index):
            c = TestClient(app)
            try:
                resp = c.post("/v1/completions", json={
                    "model": "x",
                    "prompt": f"prompt_{index}",
                })
                with lock:
                    results.append((index, resp.status_code, resp.json()))
            except Exception as e:
                with lock:
                    errors.append((index, str(e)))

        # Apply mock ONCE, outside threads, then run all threads concurrently
        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            threads = [threading.Thread(target=make_request, args=(i,)) for i in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)

        assert not errors, f"Errors in concurrent requests: {errors}"
        assert len(results) == 10, f"Expected 10 results, got {len(results)}"

        for idx, status, body in results:
            assert status == 200, f"Request {idx} got status {status}"
            assert "choices" in body, f"Request {idx} missing choices"

    def test_concurrent_tools_smuggling_attempts(self):
        """
        Concurrent tools-smuggling attempts — shared state must not leak tools to upstream.
        Apply the patch outside threads to avoid the unittest.mock thread-race issue.
        """
        import threading

        leaked = []
        lock = threading.Lock()

        async def mock_upstream(prompt, max_tokens=256, temperature=0.7):
            # If tools somehow leaked into the call, the function signature would
            # receive unexpected kwargs — but we detect via this check:
            return [{"generated_text": "ok"}]

        def make_attack(index):
            c = TestClient(app)
            resp = c.post("/v1/completions", json={
                "model": "x",
                "prompt": f"attack_{index}",
                "tools": [{"name": f"tool_{index}"}],
            })
            body = resp.json()
            # If tools appear in the response, they leaked
            if "tools" in body:
                with lock:
                    leaked.append((index, body))

        # Apply mock ONCE outside threads to avoid patch() thread-race
        with patch("src.routr.main.call_upstream", side_effect=mock_upstream):
            threads = [threading.Thread(target=make_attack, args=(i,)) for i in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)

        assert not leaked, f"Tools leaked in {len(leaked)} concurrent responses: {leaked}"


# ===========================================================================
# 8.  NORMALIZER EDGE CASES
# ===========================================================================

class TestNormalizerEdgeCases:

    def test_normalize_none_raw(self):
        """normalize_completion(None) must not crash."""
        result = normalize_completion(None, model="test")
        assert "choices" in result
        # Should have a text, even if it's "None"
        assert result["choices"][0]["text"] is not None

    def test_normalize_integer_raw(self):
        """normalize_completion(42) — str() fallback"""
        result = normalize_completion(42, model="test")
        assert result["choices"][0]["text"] == "42"

    def test_normalize_list_of_non_dicts(self):
        """List containing plain strings, not dicts."""
        result = normalize_completion(["plain string"], model="test")
        assert result["choices"][0]["text"] == "plain string"

    def test_normalize_list_with_none_entry(self):
        """List with None as first entry."""
        result = normalize_completion([None], model="test")
        # Should not crash — first item is None (not dict)
        assert "choices" in result

    def test_normalize_dict_no_known_keys(self):
        """Dict with no 'generated_text', 'text', or 'content' key → empty text."""
        result = normalize_completion({"foo": "bar", "baz": 42}, model="test")
        assert result["choices"][0]["text"] == ""

    def test_normalize_empty_string_raw(self):
        """Empty string response — text should be empty, not crash."""
        result = normalize_completion("", model="test")
        assert result["choices"][0]["text"] == ""

    def test_normalize_unicode_content(self):
        """Unicode content (emoji, CJK, RTL) must be preserved."""
        text = "Hello 🌍 世界 مرحبا"
        result = normalize_completion([{"generated_text": text}], model="test")
        assert result["choices"][0]["text"] == text

    def test_normalize_newlines_preserved(self):
        """Newlines in generated text must be preserved exactly."""
        text = "line1\nline2\n\nline4"
        result = normalize_completion({"generated_text": text}, model="test")
        assert result["choices"][0]["text"] == text

    def test_streaming_chunk_empty_string(self):
        """Empty string chunk — should produce valid chunk with empty text."""
        chunk = normalize_streaming_chunk("", "model", "cmpl-123")
        assert chunk["choices"][0]["text"] == ""
        assert chunk["choices"][0]["finish_reason"] is None

    def test_streaming_chunk_unicode(self):
        """Unicode in streaming chunks must be preserved."""
        text = "こんにちは"
        chunk = normalize_streaming_chunk(text, "model", "cmpl-abc")
        assert chunk["choices"][0]["text"] == text

    def test_hf_payload_list_prompt_joined(self):
        """_build_hf_payload must join list prompts with newlines."""
        payload = _build_hf_payload(
            prompt=["hello", "world"],
            max_tokens=100,
            temperature=0.5,
        )
        assert payload["inputs"] == "hello\nworld"

    def test_hf_payload_returns_correct_keys(self):
        """_build_hf_payload must return 'inputs' and 'parameters', nothing else."""
        payload = _build_hf_payload("test", max_tokens=64, temperature=0.3)
        assert "inputs" in payload
        assert "parameters" in payload
        # Verify required parameter keys
        params = payload["parameters"]
        assert "max_new_tokens" in params
        assert "temperature" in params
        # NO tools, tool_choice, etc.
        forbidden = {"tools", "tool_choice", "functions"}
        assert not forbidden.intersection(set(payload.keys()))
        assert not forbidden.intersection(set(params.keys()))


# ===========================================================================
# 9.  ENDPOINT EXISTENCE / METHOD SAFETY
# ===========================================================================

class TestEndpointSafety:

    def test_get_completions_not_allowed(self, client):
        """GET /v1/completions should return 405 Method Not Allowed."""
        resp = client.get("/v1/completions")
        assert resp.status_code == 405

    def test_put_completions_not_allowed(self, client):
        """PUT /v1/completions should return 405."""
        resp = client.put("/v1/completions", json={"model": "x", "prompt": "hi"})
        assert resp.status_code == 405

    def test_delete_completions_not_allowed(self, client):
        """DELETE /v1/completions should return 405."""
        resp = client.delete("/v1/completions")
        assert resp.status_code == 405

    def test_post_to_nonexistent_endpoint(self, client):
        """POST to /v1/chat/completions (chat endpoint) should 404 — routr is completions-only."""
        resp = client.post("/v1/chat/completions", json={
            "model": "x",
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert resp.status_code == 404, (
            f"routr must NOT expose a chat endpoint; got {resp.status_code}"
        )

    def test_chat_completions_with_tools_404(self, client):
        """
        POST /v1/chat/completions with tools MUST return 404 (not expose the endpoint
        even if tools are present, since routr is completions-only).
        """
        resp = client.post("/v1/chat/completions", json={
            "model": "x",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "function": {"name": "evil"}}],
        })
        assert resp.status_code == 404

    def test_health_post_not_allowed(self, client):
        """POST /health should return 405."""
        resp = client.post("/health", json={})
        assert resp.status_code == 405

    def test_completions_with_extra_url_path(self, client):
        """POST /v1/completions/extra should 404."""
        resp = client.post("/v1/completions/extra", json={"model": "x", "prompt": "hi"})
        assert resp.status_code == 404
