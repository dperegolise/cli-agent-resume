# Milestone Report: m6-backend

**Branch**: m6-backend  
**Date**: 2026-06-08  
**Status**: DONE — all 18 pytest tests pass

---

## What Was Built

### Files created (`backend/`)

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app: CORS middleware, rate-limiter guard, `POST /agent` SSE endpoint, `GET /health` |
| `agent.py` | LangChain agent loop: builds system prompt with random seeded fact, drives tool-call cycle, yields SSE event dicts |
| `tools.py` | Two LangChain tools: `search_portfolio` (keyword FTS) and `focus_item` (manifest-validated path navigation) |
| `cascade.py` | 3-tier model cascade: OpenRouter → HuggingFace → routr; routr call strips tools and uses assertion guard |
| `manifest.py` | Reads `www/` at startup; loads `manifest.json` or scans `.md` files; exposes `validate_path`, `search`, `get_manifest` |
| `rate_limiter.py` | Per-IP sliding-window (20 req/60s) with immediate 24h ban on burst; module-level state with `reset_state()` for tests |
| `requirements.txt` | Dependency declarations (no conflicting pins) |
| `requirements-dev.txt` | pytest + pytest-asyncio |
| `tests/test_cascade_tool_gating.py` | 4 tests: routr never receives tools; OpenRouter does |
| `tests/test_rate_limiter.py` | 6 tests: burst detection, ban TTL, isolation, expiry cleanup |
| `tests/test_focus_item_validation.py` | 8 tests: known paths succeed; traversal / unknown paths rejected |

---

## Key Design Decisions

### Cascade tool-gating (critical constraint)
`_call_routr` accepts `tools: None` — the type itself enforces the contract. An `assert tools is None`
guard fires before the HTTP payload is constructed. The payload dict is built without a `tools` key
and a second assertion confirms this. The cascade always calls `_call_routr(messages, tools=None)`.

### Rate limiter
Module-level `_windows` and `_bans` dicts (no class, per the strategy pseudocode). `reset_state()`
clears both dicts — tests call this in `setup_function` for isolation.

### focus_item validation
Two layers: (1) string check for `..` and leading `/` blocks traversal immediately; (2) `manifest.validate_path`
checks against the loaded entry dict. Error strings are returned (not raised) so the agent can relay
them back to the user.

### System prompt seeding
Five facts about Daniel Peregolise stored in `_FACTS`; `random.choice` picks one per `run_agent` call.
The system prompt is injected as a `SystemMessage` and never forwarded to the client.

---

## Test Results

```
18 passed in 0.09s
```

```
backend/tests/test_cascade_tool_gating.py::test_routr_never_receives_tools_when_others_fail  PASSED
backend/tests/test_cascade_tool_gating.py::test_routr_payload_has_no_tools_key_direct         PASSED
backend/tests/test_cascade_tool_gating.py::test_routr_assertion_fires_when_tools_passed       PASSED
backend/tests/test_cascade_tool_gating.py::test_openrouter_receives_tools_when_available      PASSED
backend/tests/test_focus_item_validation.py::test_known_path_succeeds                         PASSED
backend/tests/test_focus_item_validation.py::test_nested_known_path_succeeds                  PASSED
backend/tests/test_focus_item_validation.py::test_path_traversal_rejected                     PASSED
backend/tests/test_focus_item_validation.py::test_absolute_path_rejected                      PASSED
backend/tests/test_focus_item_validation.py::test_unknown_path_rejected                       PASSED
backend/tests/test_focus_item_validation.py::test_traversal_inside_path_rejected              PASSED
backend/tests/test_focus_item_validation.py::test_validate_path_true_for_known               PASSED
backend/tests/test_focus_item_validation.py::test_validate_path_false_for_unknown            PASSED
backend/tests/test_rate_limiter.py::test_21st_request_returns_false                           PASSED
backend/tests/test_rate_limiter.py::test_ip_is_banned_after_burst                             PASSED
backend/tests/test_rate_limiter.py::test_banned_request_returns_false_immediately             PASSED
backend/tests/test_rate_limiter.py::test_ban_expires_after_ttl                                PASSED
backend/tests/test_rate_limiter.py::test_different_ip_not_affected                            PASSED
backend/tests/test_rate_limiter.py::test_ban_duration_set_correctly                           PASSED
```

---

## Interface / Contract for Other Milestones

### SSE wire contract (`POST /agent`)
Request: `{"messages": [{"role": "user"|"assistant", "content": "..."}], "session_id": "uuid"}`  
Response: `text/event-stream`, events:
- `data: {"type": "token", "content": "..."}`
- `data: {"type": "focus_item", "path": "...", "error": null|"..."}`
- `data: {"type": "search_results", "results": [...]}`
- `data: {"type": "done"}`
- `data: {"type": "error", "message": "..."}`

### Rate-limit headers
- `X-Client-Banned-Until: <ISO timestamp>` on 429 responses

### Manifest startup
`manifest.load(www_dir)` must be called at startup with the path to the `www/` directory.
Falls back gracefully if `www/manifest.json` doesn't exist (scans `.md` files directly).

### Environment variables consumed
- `OPENROUTER_API_KEY`, `OPENROUTER_MODELS`
- `HF_API_KEY` / `HUGGINGFACE_API_KEY`, `HF_MODELS` / `HUGGINGFACE_MODEL`
- `ROUTR_URL` (default `http://localhost:8000`)
- `AGENT_RATE_LIMIT` (default `20`)
- `AGENT_BAN_DURATION_HOURS` (default `24`)
- `WWW_DIR` (default `www`)

---

## Known Limitations / Non-issues

- `langchain-community` and exact LangChain version pins conflict in pip; requirements.txt uses
  `>=` lower bounds. Actual installed versions: langchain 1.3.4, langchain-core 1.4.2.
- The agent streaming is word-granularity (space-split), not true token streaming — acceptable
  for the SSE contract since the frontend just appends tokens.
- routr health-check (`GET /health`) is required for the cascade to attempt that tier.
