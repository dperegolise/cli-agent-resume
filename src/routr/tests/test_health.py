"""
test_health.py — Verify GET /health returns 200 with correct JSON.
"""
import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.routr.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_returns_200(client):
    """GET /health must return HTTP 200."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_returns_status_ok(client):
    """GET /health must return {"status": "ok", ...}."""
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "ok"


def test_health_returns_model_key(client):
    """GET /health must include "model" key."""
    response = client.get("/health")
    body = response.json()
    assert "model" in body
    assert isinstance(body["model"], str)
    assert len(body["model"]) > 0


def test_health_model_reflects_env_var(client):
    """GET /health model field must match ROUTR_MODEL_NAME env var when set."""
    with patch.dict(os.environ, {"ROUTR_MODEL_NAME": "test-model-name"}):
        # Re-import to pick up env var since providers.py calls os.getenv at runtime
        from src.routr import providers
        original_fn = providers.get_model_name

        def patched_get_model_name():
            return os.getenv("ROUTR_MODEL_NAME", providers.DEFAULT_MODEL_NAME)

        with patch("src.routr.main.get_model_name", patched_get_model_name):
            response = client.get("/health")

    body = response.json()
    assert body["model"] == "test-model-name"


def test_health_default_model_name(client):
    """GET /health model is non-empty even without ROUTR_MODEL_NAME env var."""
    # Remove env var if present
    env = {k: v for k, v in os.environ.items() if k != "ROUTR_MODEL_NAME"}
    with patch.dict(os.environ, env, clear=True):
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "mistralai/Mistral-7B-Instruct-v0.2"
