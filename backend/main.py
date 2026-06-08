"""
FastAPI app entry point.

Routes:
    POST /agent  — SSE streaming agent endpoint
    GET  /health — Liveness probe

Strategy §5: SSE wire contract.
Strategy §10: rate limiter middleware.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import manifest as manifest_module
import rate_limiter
from agent import run_agent

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title="CLI Portfolio Agent", version="1.0")

# CORS — allow all origins (portfolio is public)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load manifest / search index at startup
@app.on_event("startup")
async def _startup() -> None:
    www_dir = os.getenv("WWW_DIR", "www")
    logger.info("Loading manifest from %s", www_dir)
    try:
        manifest_module.load(www_dir)
        logger.info("Manifest loaded: %d entries", len(manifest_module.get_manifest()))
    except Exception as exc:
        logger.warning("Manifest load failed (non-fatal): %s", exc)


# ── Request / response models ─────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class AgentRequest(BaseModel):
    messages: List[ChatMessage]
    session_id: str


# ── Helper: extract client IP ─────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    """Return the real client IP, honouring X-Forwarded-For."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse_event(data: Dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/agent")
async def agent_endpoint(request: Request, body: AgentRequest) -> StreamingResponse:
    client_ip = _get_client_ip(request)

    # ── Rate limit / ban check ────────────────────────────────────────────────
    if not rate_limiter.check_and_record(client_ip):
        ban_expiry_ts = rate_limiter.get_ban_expiry(client_ip)
        ban_expiry_iso = (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ban_expiry_ts))
            if ban_expiry_ts
            else "unknown"
        )

        async def _ban_stream():
            yield _sse_event({
                "type": "error",
                "message": f"Rate limit exceeded. Banned until {ban_expiry_iso}.",
            })

        return StreamingResponse(
            _ban_stream(),
            media_type="text/event-stream",
            status_code=429,
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "X-Client-Banned-Until": ban_expiry_iso,
            },
        )

    # ── Stream agent response ─────────────────────────────────────────────────
    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def _stream():
        try:
            async for event in run_agent(messages, body.session_id):
                yield _sse_event(event)
                if event.get("type") in ("done", "error"):
                    return
        except Exception as exc:
            logger.exception("Unhandled error in agent stream")
            yield _sse_event({"type": "error", "message": str(exc)})
        finally:
            # Always end with a done event if we haven't already sent one
            yield _sse_event({"type": "done"})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
