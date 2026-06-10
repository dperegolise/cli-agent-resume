# Critic Report — m7-routr

**Date:** 2026-06-08  
**Branch:** m7-routr  
**Worktree:** `.claude/worktrees/m7-routr/src/routr/`  
**Adversarial test file:** `src/routr/tests/test_adversarial.py`  
**Total new tests:** 65  
**Final result:** 85/85 pass (65 adversarial + 20 pre-existing)

---

## Attack Summary

### #1 — Tools Smuggling (10 vectors)

**Result: ALL REPELLED ✅**

Every angle tried to smuggle `tools` past Pydantic into the upstream HTTP body:

| Attack | Result |
|--------|--------|
| `{"tools": [...]}` direct field | Stripped ✅ |
| `{"TOOLS": [...]}` uppercase | Passed (not forwarded) ✅ |
| `{"tool_choice": "auto", "tools": [...]}` | Stripped ✅ |
| `{"messages": [...], "tools": [...]}` (wrong endpoint) | 422 — no route ✅ |
| `{"extra": {"tools": [...]}}` nested | Not forwarded ✅ |
| `{"tools": "auto"}` string variant | Stripped ✅ |
| `{"function_call": "auto", "functions": [...]}` legacy | Stripped ✅ |
| Prompt list with tool-call-like dicts | Joined as plain string ✅ |
| `_build_hf_payload()` unit-level inspection | No forbidden keys ✅ |
| `stream=True` + `tools` | Stripped before stream_upstream call ✅ |

**Why it works:** `CompletionRequest` Pydantic model uses `model_config = {"extra": "ignore"}` and only defines `model`, `prompt`, `max_tokens`, `temperature`, `stream`. `tools` is never a field, so Pydantic silently drops it before the validated object reaches any handler. `call_upstream` / `stream_upstream` function signatures don't accept a `tools` parameter, so even if Pydantic leaked it, there's no pathway for it to reach the upstream payload.

**Assessment:** The design is sound. The stripping happens at deserialization, before any business logic runs, which is the correct layer.

---

### #2 — Malformed / Boundary Inputs (14 tests)

**Result: ALL HANDLED ✅**

| Input | Expected | Got |
|-------|----------|-----|
| Missing `model` | 422 | 422 ✅ |
| Missing `prompt` | 422 | 422 ✅ |
| Both missing | 422 | 422 ✅ |
| Empty body `{}` | 422 | 422 ✅ |
| `max_tokens: -1` | 200 (no range validation) | 200 ✅ |
| `max_tokens: 0` | 200 | 200 ✅ |
| `temperature: 999.0` | 200 (no range validation) | 200 ✅ |
| `temperature: -1.0` | 200 | 200 ✅ |
| Non-JSON body | 422 | 422 ✅ |
| `prompt: ""` (empty string) | 200 | 200 ✅ |
| `prompt: []` (empty list) | 200 | 200 ✅ |
| `model: 42` (integer) | 200 (Pydantic coerces to "42") | 200 ✅ |
| `prompt: null` | 422 | 422 ✅ |
| `model: null` | 422 | 422 ✅ |

**Notable observation:** `max_tokens` and `temperature` have no range validation — negative values and temperatures of 999 pass through to the upstream. This is not a security issue for this proxy (the upstream will reject or clamp them), but it is worth noting that a stricter implementation would validate these ranges at the Pydantic layer.

---

### #3 — Upstream Failures (9 tests)

**Result: ALL HANDLED ✅**

| Failure | Response |
|---------|----------|
| Upstream 500 | 502 ✅ |
| Upstream 503 | 502 ✅ |
| Connection refused | 502 ✅ |
| Timeout | 502 ✅ |
| Returns unexpected JSON structure | 200 (normalizer handles gracefully) ✅ |
| Returns `None` | 200 (str() fallback) ✅ |
| Returns `{}` | 200 (empty text) ✅ |
| Returns integer `42` | 200 (str() fallback → "42") ✅ |
| Raises `ValueError` | 502 ✅ |

The `except Exception` catch-all in `main.py::completions()` correctly converts all upstream exceptions to HTTP 502, preventing any unhandled 500 from leaking internal details.

---

### #4 — Streaming Interruption (5 tests)

**Result: ALL HANDLED ✅**

| Scenario | Result |
|----------|--------|
| Mid-stream cut-off (2 chunks then error) | Error payload emitted + `[DONE]` ✅ |
| Immediate failure (0 chunks) | Error payload emitted + `[DONE]` ✅ |
| All lines are valid SSE format (`data: ...`) | ✅ |
| Streaming response with tools input → no tools in chunks | ✅ |
| Empty stream → still ends with `data: [DONE]` | ✅ |

The `_stream_response` generator's `try/except` correctly catches mid-stream errors and emits an error SSE chunk before the final `[DONE]`, preventing client hangs.

---

### #5 — Health Under Upstream Failure (3 tests)

**Result: ALL REPELLED ✅**

`GET /health` is purely local — it reads `get_model_name()` from env and returns immediately. It **never** calls `call_upstream` or `stream_upstream`. Verified by asserting these mocks are not called. Health returns 200 even when upstream is simulated as completely unavailable.

---

### #6 — Large Payload (3 tests)

**Result: ALL PASSED ✅**

- 50 KB prompt string: processed without crash, forwarded in full (no truncation)
- List prompt with 1000 entries: joined and handled correctly

No memory errors, no timeouts (mocked), no truncation.

---

### #7 — Concurrent Requests (2 tests)

**Result: 10/10 PASS ✅ (after test harness fix)**

**IMPORTANT — Discovered Bug in Test Harness (not in production code):**

During initial run, `test_10_concurrent_requests_no_corruption` intermittently produced a 502:

```
AssertionError: Request 6 got status 502
detail: 'Upstream error: [Errno -5] No address associated with hostname'
```

**Root cause:** `unittest.mock.patch` is **not thread-safe**. When 10 threads each wrap their request body in `with patch("src.routr.main.call_upstream", ...)`, thread A's `with` block exit (which restores the real function) can race with thread B still mid-request, causing the real `httpx` call to execute against the actual HuggingFace hostname — which fails DNS here (no network mock at the httpx level).

**This is NOT a bug in routr production code.** The proxy correctly handles the 502 from the real failing upstream. The fix was to apply `patch()` once outside the threads, covering all concurrent requests. After the fix, all 10 concurrent requests succeeded consistently across 50+ runs.

**Caveat:** The test still validates that the FastAPI app handles concurrent requests safely (no shared-state corruption between requests). All 10 responded with correct, isolated results.

---

### #8 — Normalizer Edge Cases (12 tests)

**Result: ALL PASSED ✅**

| Input | Result |
|-------|--------|
| `None` raw | `str(None)` → "None" in text ✅ |
| Integer `42` | `str(42)` → "42" ✅ |
| List of plain strings (not dicts) | `str(first)` ✅ |
| List with `None` entry | Handled (not dict, falls to str()) ✅ |
| Dict with no known text keys | Empty string ✅ |
| Empty string | Empty string ✅ |
| Unicode (emoji + CJK + RTL) | Preserved exactly ✅ |
| Newlines in text | Preserved exactly ✅ |
| Streaming chunk with empty string | Valid chunk with `text: ""` ✅ |
| Streaming chunk with Unicode | Preserved ✅ |
| `_build_hf_payload` with list prompt | Joined with `\n` ✅ |
| `_build_hf_payload` key audit | Only `inputs` + `parameters`; no forbidden keys ✅ |

---

### #9 — Endpoint Safety (7 tests)

**Result: ALL PASSED ✅**

| Check | Result |
|-------|--------|
| `GET /v1/completions` → 405 | ✅ |
| `PUT /v1/completions` → 405 | ✅ |
| `DELETE /v1/completions` → 405 | ✅ |
| `POST /v1/chat/completions` → 404 (no chat endpoint) | ✅ |
| `POST /v1/chat/completions` with tools → 404 | ✅ |
| `POST /health` → 405 | ✅ |
| `POST /v1/completions/extra` → 404 | ✅ |

---

## Coverage Assessment

### What the existing 20 tests covered (before adversarial suite):
- Happy-path health endpoint
- Basic normalization shapes (HuggingFace list, string, dict variants)
- Basic tools-stripping (3 scenarios, all using mock_call_upstream at function level)

### What the adversarial suite adds (65 new tests):
- **Tools smuggling at the httpx level** (intercepting actual HTTP body construction)
- **10 tools-smuggling attack variants** vs 3 in existing tests
- **Malformed input validation** (0 tests existed for this)
- **Upstream failure paths** (0 tests existed for this)
- **Streaming path** (0 tests existed for streaming at all)
- **Health independence from upstream** (0 tests)
- **Large payload handling** (0 tests)
- **Concurrency** (0 tests)
- **Normalizer edge cases** for None, integer, nested None, unicode (0 tests)
- **Endpoint method safety** (0 tests)

### Gaps remaining (not covered by any tests):
1. **No range validation on `max_tokens` / `temperature`** — accepts -1 and 999.0 without error. Low severity for a proxy; upstream will handle/clamp.
2. **`stream_upstream` fallback path** (lines 119-131 in providers.py) — the fallback from streaming to non-streaming on `HTTPStatusError` is untested.
3. **`ROUTR_MODEL_URL` env var** — no test verifies the URL is read and used correctly.
4. **Authorization header** — `HUGGINGFACE_API_KEY` env var inclusion in request headers is untested at the httpx level.
5. **No input size limit** — a 500 MB prompt would be accepted (framework-level protection only).

---

## Verdict

**routr is solid for its intended contract.** The critical constraint — tools never reach upstream — is robustly enforced at the Pydantic deserialization layer. All 10 tools-smuggling attack vectors were repelled. Error handling is correct (502 for all upstream failures, never a raw 500). The streaming path handles interruptions gracefully. Health is correctly independent of upstream state.

The one issue uncovered was in the **test harness** itself (the `patch()` thread-race), not in production code. This revealed that the existing test infrastructure would be unreliable for testing concurrent scenarios. The adversarial suite documents and fixes this limitation.

**0 production vulnerabilities found. 1 test infrastructure limitation discovered and fixed.**
