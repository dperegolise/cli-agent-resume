# Worker Report — m6-fix

**Milestone**: m6-fix (defect fix for m6-backend)  
**Branch**: m6-backend  
**Worker**: worker-m6fix  
**Date**: 2026-06-08  
**Status**: DONE

---

## Summary

Fixed the double `done` SSE emission in `_stream()` in `backend/main.py`, as required by the reviewer (review-m6.md) and strategy §5 ("done" sent exactly once).

---

## What was wrong

The `_stream()` async generator had a `finally` block that unconditionally yielded `{"type": "done"}`. On the happy path, `run_agent` (agent.py line 205) yields its own `{"type": "done"}` event — `_stream()` re-emits it, then `return`s from the `async for` loop. However, Python async generators still execute `finally` blocks on a clean `return`, so a second `done` event was emitted. This violates strategy §5.

---

## What was changed

### `backend/main.py` — `_stream()` function

**Before (defective):**
```python
async def _stream():
    try:
        async for event in run_agent(messages, body.session_id):
            yield _sse_event(event)
            if event.get("type") in ("done", "error"):
                return
    except Exception as exc:
        ...
        yield _sse_event({"type": "error", "message": str(exc)})
    finally:
        yield _sse_event({"type": "done"})  # always fires — double-done!
```

**After (fixed):**
```python
async def _stream():
    _done_sent = False
    try:
        async for event in run_agent(messages, body.session_id):
            yield _sse_event(event)
            if event.get("type") == "done":
                _done_sent = True  # guard the finally
                return
            if event.get("type") == "error":
                return  # leave _done_sent=False → finally emits done
    except Exception as exc:
        ...
        yield _sse_event({"type": "error", "message": str(exc)})
        # leave _done_sent=False → finally emits done
    finally:
        if not _done_sent:
            yield _sse_event({"type": "done"})
```

**Key design decision**: Only set `_done_sent = True` when `run_agent` itself yields `done` (happy path). When `run_agent` yields `error`, or when an unhandled exception is caught by `except`, leave `_done_sent = False` so the `finally` block still appends a closing `done` frame. This satisfies the existing adversarial test `test_stream_ends_with_done_after_error` that expects the stream to always end with `done`.

### `backend/tests/test_cascade_tool_gating.py` — new test added

Added `test_done_event_emitted_exactly_once_on_happy_path`:
- Mocks `run_agent` to yield `[{"type":"token","content":"hi"}, {"type":"done"}]`
- Calls `/agent` via FastAPI `TestClient` with a streaming response
- Parses all SSE events from the response body
- Asserts exactly 1 `{"type":"done"}` event appears

---

## Test results

```
backend/tests/test_cascade_tool_gating.py    5/5 passed  (includes new exactly-one-done test)
backend/tests/test_adversarial.py           68/68 passed (incl. test_stream_ends_with_done_after_error)
backend/tests/test_focus_item_validation.py  8/8 passed
backend/tests/test_rate_limiter.py           6/6 passed
backend/tests/test_cascade.py (if any)        —
TOTAL: 86 passed, 0 failed
```

---

## Interfaces / contracts touched

- `backend/main.py` — `_stream()` inner generator: SSE stream contract unchanged (clients still receive `token`, `focus_item`, `search_results`, `error`, `done` events in the same shapes). The only observable change is that `done` is no longer emitted twice on the happy path.
- `backend/tests/test_cascade_tool_gating.py` — test file: one new test function added, no changes to existing tests.

---

## What was NOT changed

- No changes to `agent.py`, `cascade.py`, `tools.py`, `manifest.py`, or `rate_limiter.py`
- No changes to the low-severity issues from review-m6 (focus_item test quality, regex guard, fastapi pin) — those are optional and not blocking

---

## Branch

`m6-backend`
