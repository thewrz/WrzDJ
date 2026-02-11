"""Tests for input validation and sanitization."""

import pytest

from app.core.validation import (
    is_safe_string,
    normalize_single_line,
    normalize_text,
    validate_event_code,
    validate_length,
)
from app.schemas.request import RequestCreate


class TestNormalizeText:
    """Tests for normalize_text function."""

    def test_none_input(self):
        """Test None input returns None."""
        assert normalize_text(None) is None

    def test_strip_whitespace(self):
        """Test leading/trailing whitespace is stripped."""
        assert normalize_text("  hello  ") == "hello"
        assert normalize_text("\thello\n") == "hello"

    def test_collapse_whitespace(self):
        """Test multiple whitespace is collapsed."""
        assert normalize_text("hello   world") == "hello world"
        assert normalize_text("a  b  c") == "a b c"

    def test_remove_control_chars(self):
        """Test control characters are removed."""
        assert normalize_text("hello\x00world") == "helloworld"
        assert normalize_text("test\x1fdata") == "testdata"

    def test_preserve_normal_text(self):
        """Test normal text is preserved."""
        assert normalize_text("Hello World") == "Hello World"
        assert normalize_text("Test123") == "Test123"

    def test_unicode_normalization(self):
        """Test Unicode is normalized to NFC."""
        # Composed vs decomposed é
        composed = "café"
        decomposed = "cafe\u0301"
        assert normalize_text(composed) == normalize_text(decomposed)


class TestNormalizeSingleLine:
    """Tests for normalize_single_line function."""

    def test_removes_newlines(self):
        """Test newlines are converted to spaces."""
        assert normalize_single_line("hello\nworld") == "hello world"
        assert normalize_single_line("a\r\nb") == "a b"

    def test_none_input(self):
        """Test None input returns None."""
        assert normalize_single_line(None) is None


class TestIsSafeString:
    """Tests for is_safe_string function."""

    def test_safe_strings(self):
        """Test safe strings return True."""
        assert is_safe_string("Hello World") is True
        assert is_safe_string("Test123!@#") is True
        assert is_safe_string("") is True

    def test_unsafe_strings(self):
        """Test strings with control chars return False."""
        assert is_safe_string("hello\x00world") is False
        assert is_safe_string("test\x1fdata") is False


class TestValidateEventCode:
    """Tests for validate_event_code function."""

    def test_valid_codes(self):
        """Test valid event codes."""
        assert validate_event_code("ABC123") is True
        assert validate_event_code("TEST01") is True
        assert validate_event_code("000000") is True

    def test_invalid_codes(self):
        """Test invalid event codes."""
        assert validate_event_code("") is False
        assert validate_event_code("abc123") is False  # lowercase
        assert validate_event_code("ABC12") is False  # too short
        assert validate_event_code("ABC1234") is False  # too long
        assert validate_event_code("ABC-12") is False  # special char


class TestValidateLength:
    """Tests for validate_length function."""

    def test_valid_lengths(self):
        """Test strings within length bounds."""
        assert validate_length("hello", min_len=1, max_len=10) is True
        assert validate_length("", min_len=0, max_len=10) is True
        assert validate_length("a" * 255, min_len=1, max_len=255) is True

    def test_invalid_lengths(self):
        """Test strings outside length bounds."""
        assert validate_length("", min_len=1, max_len=10) is False
        assert validate_length("hello world", min_len=1, max_len=5) is False

    def test_none_input(self):
        """Test None input."""
        assert validate_length(None, min_len=0, max_len=10) is True
        assert validate_length(None, min_len=1, max_len=10) is False


class TestURLSchemeAllowlist:
    """Tests for URL scheme validation on request source_url and artwork_url."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://open.spotify.com/track/abc123",
            "http://example.com/image.jpg",
            "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
        ],
    )
    def test_allowed_schemes(self, url: str):
        """Test that http, https, and spotify schemes are allowed."""
        req = RequestCreate(artist="A", title="T", source_url=url)
        assert req.source_url == url

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:MsgBox",
            "//evil.com/payload",
            "ftp://example.com/file",
        ],
    )
    def test_rejected_schemes(self, url: str):
        """Test that dangerous or unknown schemes are rejected."""
        with pytest.raises(Exception):
            RequestCreate(artist="A", title="T", source_url=url)

    def test_artwork_url_rejects_dangerous(self):
        """Test that artwork_url also validates schemes."""
        with pytest.raises(Exception):
            RequestCreate(artist="A", title="T", artwork_url="javascript:void(0)")

    def test_none_urls_allowed(self):
        """Test that None URLs pass validation."""
        req = RequestCreate(artist="A", title="T", source_url=None, artwork_url=None)
        assert req.source_url is None
        assert req.artwork_url is None
