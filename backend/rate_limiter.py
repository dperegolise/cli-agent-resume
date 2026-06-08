"""
Per-IP sliding window rate limiter with ban list.

Strategy §10: 20 req/60s per IP, 24h ban on breach.
"""

import os
import time
from collections import deque
from typing import Dict

# Per-IP sliding window
_windows: Dict[str, deque] = {}   # ip -> deque of timestamps (float)
_bans: Dict[str, float] = {}      # ip -> ban_expiry timestamp (float, epoch seconds)

RATE_LIMIT: int = int(os.getenv("AGENT_RATE_LIMIT", "20"))
WINDOW_SECONDS: int = 60
BAN_DURATION: int = int(os.getenv("AGENT_BAN_DURATION_HOURS", "24")) * 3600


def check_and_record(ip: str) -> bool:
    """
    Check whether *ip* is allowed to make a request; if allowed, record it.

    Returns:
        True  — request is allowed.
        False — IP is banned or the rate window was exceeded (ban is now set).
    """
    now = time.time()

    # ── 1. Check/expire ban ──────────────────────────────────────────────────
    if ip in _bans:
        if _bans[ip] > now:
            return False          # still banned
        else:
            del _bans[ip]         # ban expired — clean up

    # ── 2. Sliding-window maintenance ────────────────────────────────────────
    if ip not in _windows:
        _windows[ip] = deque()

    window = _windows[ip]
    cutoff = now - WINDOW_SECONDS

    # Drop timestamps that are outside the rolling window
    while window and window[0] < cutoff:
        window.popleft()

    # ── 3. Enforce limit ─────────────────────────────────────────────────────
    if len(window) >= RATE_LIMIT:
        # Burst detected — ban the IP immediately
        _bans[ip] = now + BAN_DURATION
        del _windows[ip]          # clear history; ban is the authority now
        return False

    # ── 4. Record and allow ──────────────────────────────────────────────────
    window.append(now)
    return True


def is_banned(ip: str) -> bool:
    """Return True if *ip* is currently under an active ban."""
    if ip not in _bans:
        return False
    if _bans[ip] > time.time():
        return True
    del _bans[ip]
    return False


def get_ban_expiry(ip: str) -> float | None:
    """Return the ban-expiry epoch timestamp for *ip*, or None if not banned."""
    return _bans.get(ip)


def reset_state() -> None:
    """Clear all windows and bans (useful for testing)."""
    _windows.clear()
    _bans.clear()
