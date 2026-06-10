# Report: m7-routr — Completions-only Proxy

**Branch**: m7-routr  
**Task**: #6  
**Status**: DONE  
**Date**: 2026-06-08

---

## What was built

### Files created (`src/routr/`)

| File | Purpose |
|------|---------|
| `src/routr/main.py` | FastAPI app; `POST /v1/completions`, `GET /health` |
| `src/routr/providers.py` | Async upstream client (HuggingFace Inference API / local); streaming + non-streaming |
| `src/routr/normalizer.py` | Normalize upstream response to OpenAI completions format |
| `src/routr/requirements.txt` | Pinned deps |
| `src/routr/tests/test_tools_stripped.py` | 3 tests: tools field never forwarded upstream |
| `src/routr/tests/test_normalization.py` | 12 tests: normalization edge cases |
| `src/routr/tests/test_health.py` | 5 tests: GET /health returns 200 + correct JSON |
| `conftest.py` | pytest path setup (worktree root on sys.path) |
| `pytest.ini` | pytest config: testpaths, asyncio_mode=auto |

---

## Key design decisions

### 1. tools stripping via Pydantic `extra="ignore"`
`CompletionRequest` does NOT include a `tools` field. The model is configured with
`model_config = {"extra": "ignore"}`, which means any `tools` key in the request body is
silently dropped before any code touches it. The upstream provider functions (`call_upstream`,
`stream_upstream`) have no tools parameter at all — they physically cannot receive tools.

This is the hardest guarantee possible: the tools field is never forwarded because it's
structurally absent from the data path.

### 2. GET /health contract
Returns `{"status": "ok", "model": <ROUTR_MODEL_NAME>}` with HTTP 200. This is the exact
format the backend cascade (`cascade.py`) hits before attempting routr as the last fallback.

### 3. HuggingFace Inference API format
Provider sends: `{"inputs": "<prompt>", "parameters": {"max_new_tokens": N, "temperature": T, "return_full_text": false}}`  
Normalizer handles: `[{"generated_text": "..."}]` list format (primary), plain string, single dict.

### 4. Streaming
For `stream: true`, returns SSE with `data: <chunk>\n\n` lines and a final `data: [DONE]\n\n`.
Each chunk matches OpenAI completions format with `finish_reason: null` (set to "stop" only on final non-streaming response).

### 5. Dependency version adjustment
Strategy pinned `pydantic==2.7.4` but `fastapi==0.136.1` requires `pydantic>=2.9.0`. Updated `requirements.txt` to `pydantic>=2.9.0`. All other pins held (fastapi==0.136.1, httpx==0.28.1, uvicorn[standard]==0.40.0, python-dotenv==1.0.1).

---

## Tests

```
src/routr/tests/test_health.py::test_health_returns_200                        PASSED
src/routr/tests/test_health.py::test_health_returns_status_ok                  PASSED
src/routr/tests/test_health.py::test_health_returns_model_key                  PASSED
src/routr/tests/test_health.py::test_health_model_reflects_env_var             PASSED
src/routr/tests/test_health.py::test_health_default_model_name                 PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_huggingface_list_format   PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_huggingface_empty_list    PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_plain_string_response     PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_dict_with_generated_text  PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_dict_with_text_key        PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_dict_with_content_key     PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_model_name_passed_through PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_unique_ids_per_call       PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_huggingface_list_multiple_entries PASSED
src/routr/tests/test_normalization.py::TestNormalizeCompletion::test_response_has_required_keys PASSED
src/routr/tests/test_normalization.py::TestNormalizeStreamingChunk::test_basic_chunk           PASSED
src/routr/tests/test_normalization.py::TestNormalizeStreamingChunk::test_chunk_preserves_whitespace PASSED
src/routr/tests/test_tools_stripped.py::test_tools_not_forwarded_non_streaming PASSED
src/routr/tests/test_tools_stripped.py::test_tools_extra_fields_stripped        PASSED
src/routr/tests/test_tools_stripped.py::test_request_without_tools_works        PASSED

20 passed, 1 warning (benign starlette/httpx deprecation)
```

---

## Interface contracts for m6-backend

The backend cascade (`backend/cascade.py`) depends on:

1. **`GET /health`** → `{"status": "ok", "model": "..."}` with HTTP 200. No auth required.
2. **`POST /v1/completions`** request body:
   ```json
   {"model": "...", "prompt": "...", "max_tokens": 256, "temperature": 0.7, "stream": false}
   ```
3. **Response** (non-streaming): OpenAI completions JSON with `choices[0].text`.
4. **Response** (streaming): SSE lines `data: <json>\n\n` ending with `data: [DONE]\n\n`.
5. **Environment**: `ROUTR_MODEL_URL`, `ROUTR_MODEL_NAME`, `ROUTR_HOST` (default 127.0.0.1), `ROUTR_PORT` (default 8000).
6. **Run**: `uvicorn src.routr.main:app --host 127.0.0.1 --port 8000` from repo root.

---

## What passed / failed

- All 20 pytest tests: PASSED
- No test failures or errors
- 1 benign deprecation warning from starlette TestClient (irrelevant to functionality)
