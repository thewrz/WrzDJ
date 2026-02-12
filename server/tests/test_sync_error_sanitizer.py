"""Tests for sync error message sanitization.

Ensures that httpx exceptions (which can contain Bearer tokens,
client secrets, and full URLs) never leak into sync_results_json.
"""

from unittest.mock import MagicMock

import httpx

from app.services.sync.base import sanitize_sync_error


class TestSanitizeSyncError:
    def test_httpx_status_error(self):
        """HTTPStatusError returns generic message with status code."""
        response = MagicMock()
        response.status_code = 401
        request = MagicMock()
        exc = httpx.HTTPStatusError("401 Unauthorized", request=request, response=response)
        result = sanitize_sync_error(exc)
        assert result == "External API error: HTTP 401"

    def test_httpx_timeout(self):
        """TimeoutException returns generic timeout message."""
        exc = httpx.TimeoutException("Connection timed out after 15s")
        result = sanitize_sync_error(exc)
        assert result == "External API timeout"

    def test_httpx_connect_error(self):
        """ConnectError returns generic connection message."""
        exc = httpx.ConnectError("Failed to connect to api.beatport.com:443")
        result = sanitize_sync_error(exc)
        assert result == "External API connection failed"

    def test_generic_exception(self):
        """Non-httpx exceptions return generic failure message."""
        exc = ValueError("secret stuff Bearer sk-xxx client_secret=abc123")
        result = sanitize_sync_error(exc)
        assert result == "Sync operation failed"

    def test_never_contains_bearer_token(self):
        """Output never contains Bearer token strings."""
        response = MagicMock()
        response.status_code = 500
        request = MagicMock()
        exc = httpx.HTTPStatusError(
            "Server error with Authorization: Bearer sk-secret-token-123",
            request=request,
            response=response,
        )
        result = sanitize_sync_error(exc)
        assert "Bearer" not in result
        assert "sk-secret" not in result

    def test_httpx_error_url_not_in_output(self):
        """URLs (which may contain tokens in query params) are NOT in output."""
        exc = httpx.ConnectError(
            "https://api.beatport.com/v4/auth/o/token/?client_secret=my-secret"
        )
        result = sanitize_sync_error(exc)
        assert "client_secret" not in result
        assert "my-secret" not in result
        assert "beatport.com" not in result
