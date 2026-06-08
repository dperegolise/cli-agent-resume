"""
Tests for rate_limiter.py (strategy §10).

Scenarios:
  - 21 rapid requests from the same IP: 21st returns False
  - After burst, IP is in _bans
  - Ban expires after BAN_DURATION
  - A different IP is not affected
"""

import sys
import os
import time

# Ensure the backend package root is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import rate_limiter


def setup_function():
    """Reset limiter state before each test."""
    rate_limiter.reset_state()
    # Force a small limit so tests are fast
    rate_limiter.RATE_LIMIT = 20


def test_21st_request_returns_false():
    """Sending RATE_LIMIT+1 requests should be denied on the last one."""
    rate_limiter.RATE_LIMIT = 20
    ip = "192.168.1.1"

    results = [rate_limiter.check_and_record(ip) for _ in range(21)]

    # First 20 should be allowed
    assert all(results[:20]), "First 20 requests should be allowed"
    # 21st should be denied (triggers ban)
    assert results[20] is False, "21st request should be denied"


def test_ip_is_banned_after_burst():
    """After the burst triggers, the IP should appear in the ban dict."""
    rate_limiter.RATE_LIMIT = 20
    ip = "10.0.0.1"

    for _ in range(21):
        rate_limiter.check_and_record(ip)

    assert rate_limiter.is_banned(ip), "IP should be banned after burst"
    assert ip in rate_limiter._bans, "IP should appear in _bans dict"


def test_banned_request_returns_false_immediately():
    """Subsequent calls on a banned IP must return False without consuming window."""
    rate_limiter.RATE_LIMIT = 20
    ip = "172.16.0.1"

    for _ in range(21):
        rate_limiter.check_and_record(ip)

    # Further requests should still return False
    assert rate_limiter.check_and_record(ip) is False
    assert rate_limiter.check_and_record(ip) is False


def test_ban_expires_after_ttl():
    """A ban with a past expiry timestamp should be cleaned up and allow the IP again."""
    rate_limiter.RATE_LIMIT = 20
    ip = "203.0.113.5"

    # Manually inject an already-expired ban
    rate_limiter._bans[ip] = time.time() - 1  # 1 second in the past

    # The next check should see the expiry, clean it up, and allow the request
    result = rate_limiter.check_and_record(ip)
    assert result is True, "Expired ban should be cleaned up and request allowed"
    assert ip not in rate_limiter._bans, "Expired ban should be removed from _bans"


def test_different_ip_not_affected():
    """Banning one IP must not affect a different IP."""
    rate_limiter.RATE_LIMIT = 20
    banned_ip = "198.51.100.1"
    clean_ip = "198.51.100.2"

    # Trigger ban on banned_ip
    for _ in range(21):
        rate_limiter.check_and_record(banned_ip)

    assert rate_limiter.is_banned(banned_ip), "banned_ip should be banned"

    # clean_ip should still work fine
    for _ in range(5):
        assert rate_limiter.check_and_record(clean_ip) is True, (
            "clean_ip should be unaffected by another IP's ban"
        )


def test_ban_duration_set_correctly():
    """Ban expiry should be approximately now + BAN_DURATION."""
    rate_limiter.RATE_LIMIT = 20
    ip = "192.0.2.1"

    for _ in range(21):
        rate_limiter.check_and_record(ip)

    expiry = rate_limiter.get_ban_expiry(ip)
    assert expiry is not None

    expected = time.time() + rate_limiter.BAN_DURATION
    # Allow 5-second tolerance for test execution time
    assert abs(expiry - expected) < 5, (
        f"Ban expiry {expiry} should be ~{expected} (±5s)"
    )
