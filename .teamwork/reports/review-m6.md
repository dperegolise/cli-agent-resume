# Review Report — m6-backend

**Milestone**: m6-backend  
**Branch**: m6-backend  
**Reviewer**: Reviewer  
**Date**: 2026-06-08  
**Verdict**: CHANGES-REQUESTED

---

## Summary

The implementation is largely correct and well-structured. The critical cascade tool-gating invariant (routr never receives tools) is properly enforced with both a hard assertion and a double payload sanity check. Rate limiting, path validation, stateless history, and test coverage are all solid. However, there are two genuine defects and a few minor issues that should be fixed before merge.

---

## Per-Checklist Findings

### 1. SSE Event Shapes — PASS (with note)

All five event types are yielded with the correct JSON payload shapes:
- `token`: `{"type": "token", "content": "..."}` — agent.py lines 201-202
- `focus_item`: `{"type": "focus_item", "path": "...", "error": null|"..."}` — agent.py lines 173-177
- `search_results`: `{"type": "search_results", "results": [...]}` — agent.py lines 179-183
- `done`: `{"type": "done"}` — agent.py line 205 and main.py lines 111-114
- `error`: `{"type": "error", "message": "..."}` — agent.py line 131, main.py lines 111-113, 138

**Note**: Strategy §5 shows named SSE events (`event: token\ndata: {...}`) but `_sse_event()` emits only the `data:` line. Per the m3 contract (parses by reading `type` from the JSON data), the data-only format is intentionally correct and backward-compatible. Not a bug.

---

### 2. Exactly Two Tools — PASS

`_TOOLS = [search_portfolio, focus_item]` (agent.py line 79). No other tools are registered. Grep confirms only these two `@tool` decorators exist in tools.py.

---

### 3. focus_item Path Validation — PASS (with minor note)

**Traversal guard** (tools.py lines 50-51): Checks `".." in path` (catches embedded traversal like `projects/../etc/passwd`) and `path.startswith("/")` (absolute paths). Both are correctly returned as error strings without raising.

**Manifest validation** (tools.py lines 54-58): Defers to `manifest_module.validate_path(path)`. Non-manifest paths return an error string, never raise.

**Note**: Strategy §6 specifies a regex pattern `^[a-z0-9/_-]+\.md$` as an additional guard. The implementation relies solely on manifest validation instead. This is functionally equivalent for runtime safety (any path not in the manifest is rejected), but it deviates from the specified pattern — an input with spaces or unusual characters that isn't in the manifest will still be rejected by the manifest check rather than the regex. Low severity.

**Test coverage**: `test_focus_item_validation.py` covers traversal, absolute paths, embedded traversal, unknown paths, and known paths. 8 tests. However the tests use an **inline mirror** of the validation logic (`_focus_item`) rather than importing the actual `@tool` decorated function from `tools.py`. This is acceptable for unit isolation but means the test does not directly exercise the LangChain `@tool` wrapper. No functional risk given the logic is identical, but the coverage gap should be noted.

---

### 4. Model Cascade Order — PASS

`call_with_cascade()` (cascade.py lines 227-253): Tries OpenRouter → HuggingFace → routr, in that order, with individual `try/except` blocks between each tier. Each failure appends to `errors` and falls through to the next. Correct.

---

### 5. CRITICAL: routr Never Receives Tool Defs — PASS

**Strongly enforced.** Three layers of protection:
1. `call_with_cascade()` line 250: explicitly passes `tools=None` to `_call_routr`.
2. `_call_routr()` line 170: `assert tools is None` — hard assertion that will raise `AssertionError` if violated.
3. `_call_routr()` line 185: `assert "tools" not in payload` — double-checks the payload dict before HTTP call.

The type signature `tools: None` at cascade.py line 162 provides a static type-level signal as well.

---

### 6. Routr Health Check — PASS

`_routr_available()` (cascade.py lines 68-75): performs a `GET {ROUTR_URL}/health` with 2s timeout, returns `True` only on HTTP 200. `_routr_url()` reads `ROUTR_URL` env var with fallback to `http://localhost:8000`.

---

### 7. System Prompt Server-Side Only — PASS

`_build_system_prompt()` (agent.py lines 41-59): builds the system prompt with a randomly selected fact, injected via `SystemMessage` into the LangChain message list (line 99). The system prompt is never included in any SSE event yield — confirmed by reading the entire `run_agent` generator.

Five seeded facts present (lines 32-37), `random.choice` used (line 42). System prompt confidentiality is noted in the prompt itself (line 58).

---

### 8. Stateless Rolling History — PASS

`run_agent()` accepts `messages: List[Dict[str, str]]` directly from the request body (agent.py line 83). No server-side session state. The function reconstructs the full conversation from the passed messages each call (lines 101-108). `session_id` is accepted but not used for history storage — confirmed.

---

### 9. Rate Limiter — PASS (with one defect)

**Core logic** (rate_limiter.py): Sliding window 20 req/60s, 24h ban on breach. Env vars `AGENT_RATE_LIMIT` and `AGENT_BAN_DURATION_HOURS` are read at module level (lines 16-18). `check_and_record()` correctly maintains the deque, prunes old timestamps, and bans on breach.

**Integration** (main.py lines 102-125): Rate check occurs before agent execution. On ban, emits an SSE `error` event with ban expiry and returns HTTP 429 with `X-Client-Banned-Until` header.

**DEFECT — Double `done` emission (main.py lines 130-141)**: The `_stream()` async generator has a `finally` block that unconditionally yields `{"type": "done"}`. On the happy path, `run_agent` yields `{"type": "done"}` (agent.py line 205), which is emitted at main.py line 133, then `return` on line 135 exits the `async for` loop. However, Python async generators still execute `finally` blocks on clean exit, so the `finally` at line 139-141 emits a second `done` event. Strategy §5 states: *"Sent exactly once at the end of the SSE stream."* This is a spec violation.

**Fix**: Track whether `done` was already emitted and guard the `finally` yield:
```python
_done_sent = False
async for event in run_agent(messages, body.session_id):
    yield _sse_event(event)
    if event.get("type") in ("done", "error"):
        _done_sent = True
        return
# ...
finally:
    if not _done_sent:
        yield _sse_event({"type": "done"})
```

---

### 10. Pydantic Version — PASS

`requirements.txt` line 8: `pydantic>=2.9.0`. Correct per the checklist requirement for FastAPI compatibility. Note: strategy §8 specifies `pydantic==2.7.4` (the strategy may have been written before the FastAPI version compatibility constraint was discovered). The `>=2.9.0` pin in requirements.txt is the correct override.

`fastapi>=0.115.0` (requirements.txt line 1) is not pinned to the exact `0.136.1` from strategy §8. This is a looser pin but compatible for `>=0.115.0`.

---

### 11. Test Coverage — PARTIAL PASS (18 tests, but a gap)

Total: 6 (rate_limiter) + 4 (cascade) + 8 (focus_item) = **18 tests**. Count matches the checklist.

**Cascade tool-gating test** (`test_cascade_tool_gating.py`): `test_routr_never_receives_tools_when_others_fail()` (line 71) mocks httpx.AsyncClient, patches `_routr_available` to True, and verifies that the body of the POST to `/v1/completions` has no `tools` key. This directly satisfies the checklist requirement.

**Gap**: The double-`done` defect identified in item 9 above has no test. The existing tests do not cover the full `_stream()` path in main.py (no integration test exercising the FastAPI endpoint).

---

## Issues Summary

| Severity | Location | Issue |
|----------|----------|-------|
| **Medium** | `main.py:130-141` | `_stream()` async generator emits `done` twice on happy path — `finally` block unconditionally yields `done` even after `run_agent` already yielded it. Violates §5 spec ("sent exactly once"). |
| **Low** | `tests/test_focus_item_validation.py:41-50` | Tests exercise an inline mirror of `tools.focus_item` logic rather than the actual decorated function. No functional risk but reduces confidence that the tool wrapper itself works correctly. |
| **Low** | `tools.py:50-51` | Strategy §6 specifies regex pattern `^[a-z0-9/_-]+\.md$` as a validation guard; implementation only checks for `..` and absolute paths, relying on manifest validation for all other rejections. Functionally safe but diverges from spec. |
| **Low** | `requirements.txt:1` | `fastapi>=0.115.0` is a floor-only constraint; strategy §8 pins `fastapi==0.136.1`. An accidental install of a future incompatible version is possible. Consider `fastapi>=0.115.0,<2.0.0` or pin to `0.136.1`. |

---

## Required Changes Before Merge

1. **Fix double-`done` emission** in `main.py:_stream()` — add a flag to guard the `finally` yield. This is a protocol correctness issue with a clear, mechanical fix.

The other issues (low severity) may optionally be fixed but are not blocking. The double-`done` issue is the single CHANGES-REQUESTED blocker.
