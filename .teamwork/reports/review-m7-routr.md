# Review: m7-routr — Completions-only Proxy

**Reviewer**: Reviewer teammate  
**Branch**: m7-routr  
**Date**: 2026-06-08  
**Verdict**: PASS

---

## Overall Assessment

The implementation is clean, correct, and satisfies all interface contracts for this milestone. The critical tools-stripping invariant is enforced at the right architectural layer (Pydantic model deserialization), with no bypass paths. All 20 tests pass and cover the key requirements meaningfully.

---

## Per-Checklist Findings

### 1. POST /v1/completions — accepts OpenAI completions format
**PASS**

`main.py:54` defines `@app.post("/v1/completions")` accepting a `CompletionRequest` with `model`, `prompt`, `max_tokens` (default 256), `temperature` (default 0.7), and `stream` (default False). The `prompt` field accepts both `str` and `list` (`Union[str, list]`), which correctly handles both single-string and multi-element prompt arrays. All required OpenAI-format fields are present with sensible defaults.

### 2. tools field hard constraint
**PASS — strong enforcement**

Three sub-checks:

**(a) Pydantic model uses `extra="ignore"`**: `main.py:38` sets `model_config = {"extra": "ignore"}` on `CompletionRequest`. The `tools` field is absent from the model definition, so it is silently discarded during deserialization. This is the correct and idiomatic Pydantic v2 approach.

**(b) No `request.body()` / raw dict passthrough**: The endpoint signature (`completions(req: CompletionRequest)`) uses Pydantic model binding exclusively. There is no `Request` import from Starlette, no `await request.body()` call, and no raw `dict` passthrough anywhere in `main.py` or `providers.py`. Confirmed by `grep` scan.

**(c) Providers never include a `tools` key**: `providers.py:42-50` (`_build_hf_payload`) constructs the upstream payload with only `inputs` and `parameters` (max_new_tokens, temperature, return_full_text). No tools key anywhere in this function or in `call_upstream` / `stream_upstream`. The functions don't even have a `tools` parameter — it is structurally impossible to forward tools.

The tools isolation is a hard structural guarantee, not a conditional check — strongest possible enforcement.

### 3. Response normalization — OpenAI completions shape
**PASS**

`normalizer.py:38-55` returns:
```
{
  "id": "cmpl-<24 hex chars>",
  "object": "text_completion",
  "created": <int timestamp>,
  "model": <model name>,
  "choices": [{"text": ..., "index": 0, "finish_reason": "stop"}],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
```
This matches the OpenAI completions format. The `usage` block has all three required fields. `object` is correctly `"text_completion"` (not `"chat.completion"`). `finish_reason` correctly uses `"stop"` on non-streaming and `null` on streaming chunks.

Minor note: `usage.prompt_tokens` / `completion_tokens` are always 0 since token counting isn't implemented. This is a reasonable simplification for a proxy tier; the strategy and INTENT make no requirement for accurate token counts here.

### 4. GET /health — HTTP 200 with {"status":"ok"}
**PASS**

`main.py:45-51` defines `@app.get("/health")` returning `{"status": "ok", "model": get_model_name()}`. Returns HTTP 200 (FastAPI default). This is exactly the contract the backend cascade checks (`cascade.py` in strategy §9: hits `/health`, checks for 200 before routing there). The extra `"model"` key is additive and benign.

### 5. Streaming — SSE with data: lines ending in data: [DONE]
**PASS**

`main.py:88-106` (`_stream_response` generator) yields:
- `data: {json}\n\n` for each chunk (correctly double-newline terminated)
- `data: [DONE]\n\n` as the final sentinel

The `StreamingResponse` is set with `media_type="text/event-stream"` and appropriate cache headers. SSE format is correct.

One design note: streaming errors are also sent as `data: {error payload}\n\n` followed by `data: [DONE]\n\n` rather than raising an HTTP error. This is SSE-idiomatic and acceptable — the client can detect the error payload shape.

### 6. Non-streaming — JSON directly
**PASS**

The non-streaming path (`main.py:75-85`) calls `call_upstream`, wraps exceptions as `HTTPException(502)`, and returns the normalized dict directly (FastAPI serializes to JSON). Correct.

### 7. Env configuration — ROUTR_MODEL_URL and ROUTR_MODEL_NAME
**PASS**

`providers.py:23-29`: `get_model_url()` reads `ROUTR_MODEL_URL` env var with a sensible HuggingFace default. `get_model_name()` reads `ROUTR_MODEL_NAME` with a sensible default of `"mistralai/Mistral-7B-Instruct-v0.2"`. Both functions call `os.getenv()` at runtime (not at import time), so tests can override them with `patch.dict(os.environ, ...)` without restart — confirmed working in `test_health.py:40-54`.

Additional env vars `ROUTR_HOST` and `ROUTR_PORT` are present in `main.py:116-118` for the `if __name__ == "__main__"` block, documented in the worker report's interface contract.

### 8. Test coverage — 20 tests, tools-stripping meaningfully tested
**PASS**

20 tests across 3 files:
- `test_health.py`: 5 tests (HTTP 200, status:ok, model key, env var reflection, default)
- `test_normalization.py`: 12 tests (HF list format, empty list, plain string, dict variants, model passthrough, unique IDs, multiple entries, required keys, streaming chunk shape, whitespace preservation)
- `test_tools_stripped.py`: 3 tests

The tools-stripping tests are **substantively correct** — they mock `call_upstream` at the point where it's called from `main.py` (using `patch("src.routr.main.call_upstream")`), capture the actual keyword arguments received, and assert `"tools" not in upstream_call`. This tests that tools never reach the provider function signature, not merely that the Pydantic model definition lacks the field. This is the right level of behavioral testing.

One gap: no integration-level test for `stream=True` through the full SSE response path (the normalization tests cover `normalize_streaming_chunk` in isolation, but there's no end-to-end test posting `{"stream": true}` and verifying the `text/event-stream` response with `data:` lines and `[DONE]`). This is a minor coverage gap — the non-streaming path is fully tested and the streaming logic is straightforward — but it means a regression in the SSE generator would go undetected.

### 9. Standalone runnable — uvicorn src.routr.main:app
**PASS**

The module path `src.routr.main:app` is correct (`app = FastAPI(...)` at module level in `src/routr/main.py`). The `if __name__ == "__main__"` block and `requirements.txt` include `uvicorn[standard]`. The worker report confirms `conftest.py` puts the worktree root on `sys.path`. For standalone operation outside tests, running from the repo root with `uvicorn src.routr.main:app` will work since `src/` is a package with `__init__.py`.

---

## Issues Found

### Minor Issues (non-blocking)

1. **No streaming end-to-end test** (`test_tools_stripped.py` / new file): There is no test that posts `{"stream": true, ...}` to `/v1/completions` and verifies the SSE response structure (`Content-Type: text/event-stream`, `data: ...\n\n` chunks, `data: [DONE]\n\n` terminator). The `normalize_streaming_chunk` function is unit-tested, but the generator and `StreamingResponse` wiring are not. A regression here (e.g., dropping the `\n\n`, wrong media type) would be invisible to the test suite. **Recommended but not blocking** for integration.

2. **`stream_upstream` fallback silently swallows HTTPStatusError** (`providers.py:119-130`): When the upstream HTTP call fails for streaming, it falls back to a non-streaming call and yields a single chunk — without any indication to the caller that fallback occurred. This is fine operationally, but there is no test covering this fallback path. Again, not blocking.

3. **`prompt` type annotation**: `CompletionRequest.prompt` is `Union[str, list]` with no inner type constraint (e.g., `list[str]`). If a caller sends `{"prompt": [1, 2, 3]}`, `_build_hf_payload` joins them as `"1\n2\n3"` which is benign but subtly odd. The HuggingFace API typically expects a string prompt anyway. This is a very minor type-looseness, not a functional problem.

### No Blocking Issues

None of the above require changes before integration. The implementation correctly satisfies all stated interface contracts.

---

## Interface Contract Verification (for m6-backend)

The strategy (`strategy-m0.md:1122-1140`) shows `cascade.call_routr` expects:
- `GET /health` → 200 with `{"status": "ok", ...}` ✓
- `POST /v1/completions` with `{model, prompt, temperature, max_tokens}` (no tools) ✓
- SSE streaming response with `data:` lines ✓
- Env var `ROUTR_URL` on the backend side (pointing to `http://localhost:8000`) ✓

All contracts are honored.

---

## Verdict: PASS

The milestone is correct and ready for integration. The tools-stripping invariant is implemented at the strongest possible level (structural absence from the data path, not a runtime filter). All 20 tests are meaningful and pass. The streaming gap is a minor coverage debt but does not affect the correctness of the implementation.
