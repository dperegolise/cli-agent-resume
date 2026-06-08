"""
main.py — routr: completions-only HTTP proxy in OpenAI completions format.

Endpoints:
  POST /v1/completions  — proxy to upstream (HuggingFace / local model)
  GET  /health          — liveness check

Critical constraint: `tools` field is NEVER forwarded upstream.
Any `tools` key in the request body is silently stripped via Pydantic model_config extra="ignore".
"""
import json
import os
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from typing import Union

from .providers import call_upstream, get_model_name, stream_upstream
from .normalizer import normalize_completion, normalize_streaming_chunk

app = FastAPI(title="routr", description="Completions-only model proxy (no tools)")


# ---------------------------------------------------------------------------
# Request model — tools is explicitly NOT included.
# extra="ignore" ensures any stray fields (incl. tools) are silently dropped.
# ---------------------------------------------------------------------------

class CompletionRequest(BaseModel):
    model: str
    prompt: Union[str, list]
    max_tokens: int = 256
    temperature: float = 0.7
    stream: bool = False

    model_config = {"extra": "ignore"}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    """
    Liveness check. Returns 200 with {"status": "ok", "model": <model_name>}.
    Used by the backend cascade health-check before attempting routr.
    """
    return {"status": "ok", "model": get_model_name()}


@app.post("/v1/completions")
async def completions(req: CompletionRequest):
    """
    Proxy to upstream model.

    - tools field is silently stripped by Pydantic (not in CompletionRequest, extra='ignore').
    - Returns OpenAI completions format.
    - Supports streaming via SSE when stream=True.
    """
    model_name = get_model_name()

    if req.stream:
        return StreamingResponse(
            _stream_response(req, model_name),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        try:
            raw = await call_upstream(
                prompt=req.prompt,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

        result = normalize_completion(raw, model=model_name, prompt=str(req.prompt))
        return result


async def _stream_response(req: CompletionRequest, model_name: str):
    """
    Async generator that yields SSE chunks for streaming completions.
    """
    completion_id = f"cmpl-{uuid.uuid4().hex[:24]}"

    try:
        async for text_chunk in stream_upstream(
            prompt=req.prompt,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        ):
            chunk = normalize_streaming_chunk(text_chunk, model_name, completion_id)
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as exc:
        error_payload = {"error": {"message": str(exc), "type": "upstream_error"}}
        yield f"data: {json.dumps(error_payload)}\n\n"

    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Entrypoint (for running standalone: uvicorn src.routr.main:app)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("ROUTR_HOST", "127.0.0.1")
    port = int(os.getenv("ROUTR_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
