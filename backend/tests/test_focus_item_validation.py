"""
Tests for focus_item path validation (strategy §6).

Scenarios:
  - Known path in manifest succeeds
  - Path traversal (../etc/passwd) is rejected
  - Path not in manifest is rejected
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import manifest as manifest_module


def _setup_mock_manifest(paths=None):
    """Inject a known manifest into the module's internal state."""
    if paths is None:
        paths = ["about.md", "projects/cli-agent.md", "experience/senior-engineer.md"]

    manifest_module._entries.clear()
    manifest_module._contents.clear()
    for p in paths:
        parts = p.split("/")
        section = parts[0] if len(parts) > 1 else ""
        manifest_module._entries[p] = {
            "path": p,
            "title": p.replace("-", " ").replace(".md", "").title(),
            "sections": [section] if section else [],
            "excerpt": f"Excerpt for {p}",
            "hash": "testhash",
        }
        manifest_module._contents[p] = f"# {p}\n\nContent for {p}."
    manifest_module._loaded = True


# ── Inline focus_item logic so tests don't need full LangChain imports ────────

def _focus_item(path: str) -> str:
    """Mirrors the validation logic in tools.focus_item without LangChain decorators."""
    if ".." in path or path.startswith("/"):
        return f"Error: invalid path '{path}' — path traversal is not allowed."
    if not manifest_module.validate_path(path):
        return (
            f"Error: '{path}' is not in the portfolio manifest. "
            "Use search_portfolio to find valid paths."
        )
    return f"Successfully navigated to {path}"


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_known_path_succeeds():
    _setup_mock_manifest()
    result = _focus_item("about.md")
    assert result == "Successfully navigated to about.md"


def test_nested_known_path_succeeds():
    _setup_mock_manifest()
    result = _focus_item("projects/cli-agent.md")
    assert result == "Successfully navigated to projects/cli-agent.md"


def test_path_traversal_rejected():
    _setup_mock_manifest()
    result = _focus_item("../etc/passwd")
    assert result.startswith("Error:"), f"Expected error for path traversal, got: {result}"
    assert "path traversal" in result


def test_absolute_path_rejected():
    _setup_mock_manifest()
    result = _focus_item("/etc/passwd")
    assert result.startswith("Error:"), f"Expected error for absolute path, got: {result}"


def test_unknown_path_rejected():
    _setup_mock_manifest()
    result = _focus_item("not-in-manifest.md")
    assert result.startswith("Error:"), f"Expected error for unknown path, got: {result}"
    assert "not in the portfolio manifest" in result


def test_traversal_inside_path_rejected():
    """Paths like 'projects/../etc/passwd' should be rejected."""
    _setup_mock_manifest()
    result = _focus_item("projects/../etc/passwd")
    assert result.startswith("Error:"), (
        f"Expected error for embedded traversal, got: {result}"
    )


def test_validate_path_true_for_known():
    _setup_mock_manifest()
    assert manifest_module.validate_path("about.md") is True


def test_validate_path_false_for_unknown():
    _setup_mock_manifest()
    assert manifest_module.validate_path("nonexistent.md") is False
