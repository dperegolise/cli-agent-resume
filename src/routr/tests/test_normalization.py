"""
test_normalization.py — Verify normalizer produces correct OpenAI completions shape.
"""
import pytest

from src.routr.normalizer import normalize_completion, normalize_streaming_chunk


class TestNormalizeCompletion:
    """Tests for normalize_completion()."""

    def test_huggingface_list_format(self):
        """HuggingFace returns [{"generated_text": "..."}] — should normalize correctly."""
        raw = [{"generated_text": "The answer is 42."}]
        result = normalize_completion(raw, model="mistralai/Mistral-7B-Instruct-v0.2")

        # Check top-level shape
        assert result["object"] == "text_completion"
        assert result["model"] == "mistralai/Mistral-7B-Instruct-v0.2"
        assert "id" in result
        assert result["id"].startswith("cmpl-")
        assert "created" in result
        assert isinstance(result["created"], int)

        # Check choices
        assert len(result["choices"]) == 1
        choice = result["choices"][0]
        assert choice["text"] == "The answer is 42."
        assert choice["index"] == 0
        assert choice["finish_reason"] == "stop"

        # Check usage
        assert result["usage"]["prompt_tokens"] == 0
        assert result["usage"]["completion_tokens"] == 0
        assert result["usage"]["total_tokens"] == 0

    def test_huggingface_empty_list(self):
        """Empty HuggingFace list should produce empty text, not crash."""
        raw = []
        result = normalize_completion(raw, model="test-model")

        assert result["object"] == "text_completion"
        assert result["choices"][0]["text"] == ""
        assert result["choices"][0]["finish_reason"] == "stop"

    def test_plain_string_response(self):
        """Some local models return a plain string."""
        raw = "This is the generated text."
        result = normalize_completion(raw, model="local-model")

        assert result["choices"][0]["text"] == "This is the generated text."
        assert result["object"] == "text_completion"

    def test_dict_with_generated_text(self):
        """Single dict with generated_text key."""
        raw = {"generated_text": "Response from single dict."}
        result = normalize_completion(raw, model="test-model")

        assert result["choices"][0]["text"] == "Response from single dict."

    def test_dict_with_text_key(self):
        """Some providers use 'text' instead of 'generated_text'."""
        raw = {"text": "Response via text key."}
        result = normalize_completion(raw, model="test-model")

        assert result["choices"][0]["text"] == "Response via text key."

    def test_dict_with_content_key(self):
        """Some providers use 'content'."""
        raw = {"content": "Response via content key."}
        result = normalize_completion(raw, model="test-model")

        assert result["choices"][0]["text"] == "Response via content key."

    def test_model_name_passed_through(self):
        """Model name in response must match what was passed in."""
        raw = [{"generated_text": "test"}]
        result = normalize_completion(raw, model="custom-model-name")
        assert result["model"] == "custom-model-name"

    def test_unique_ids_per_call(self):
        """Each call must produce a unique ID."""
        raw = [{"generated_text": "test"}]
        r1 = normalize_completion(raw, model="m")
        r2 = normalize_completion(raw, model="m")
        assert r1["id"] != r2["id"]

    def test_huggingface_list_multiple_entries(self):
        """When HuggingFace returns multiple results, use only the first."""
        raw = [
            {"generated_text": "First result"},
            {"generated_text": "Second result"},
        ]
        result = normalize_completion(raw, model="model")
        assert result["choices"][0]["text"] == "First result"

    def test_response_has_required_keys(self):
        """Full set of required keys must be present."""
        raw = [{"generated_text": "test"}]
        result = normalize_completion(raw, model="m")

        required_keys = {"id", "object", "created", "model", "choices", "usage"}
        assert required_keys.issubset(set(result.keys()))

        usage_keys = {"prompt_tokens", "completion_tokens", "total_tokens"}
        assert usage_keys.issubset(set(result["usage"].keys()))


class TestNormalizeStreamingChunk:
    """Tests for normalize_streaming_chunk()."""

    def test_basic_chunk(self):
        """Streaming chunk should have correct shape."""
        chunk = normalize_streaming_chunk("Hello ", "test-model", "cmpl-abc123")

        assert chunk["id"] == "cmpl-abc123"
        assert chunk["object"] == "text_completion"
        assert chunk["model"] == "test-model"
        assert len(chunk["choices"]) == 1
        assert chunk["choices"][0]["text"] == "Hello "
        assert chunk["choices"][0]["index"] == 0
        assert chunk["choices"][0]["finish_reason"] is None

    def test_chunk_preserves_whitespace(self):
        """Text content (including whitespace) must be preserved exactly."""
        chunk = normalize_streaming_chunk("  leading spaces", "m", "id-1")
        assert chunk["choices"][0]["text"] == "  leading spaces"
