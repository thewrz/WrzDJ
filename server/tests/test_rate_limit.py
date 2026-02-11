"""Tests for rate limiting and client IP extraction (server/app/core/rate_limit.py)."""

from unittest.mock import MagicMock, patch

import pytest
from starlette.responses import JSONResponse

from app.core.rate_limit import (
    MAX_FINGERPRINT_LENGTH,
    _get_trusted_proxies,
    _is_trusted_proxy,
    get_client_fingerprint,
    get_client_ip,
    rate_limit_exceeded_handler,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    """Clear the lru_cache between tests so each test controls its own config."""
    _get_trusted_proxies.cache_clear()
    yield
    _get_trusted_proxies.cache_clear()


def _make_settings(trusted_proxies: str):
    """Create a mock Settings object with the given trusted_proxies value."""
    settings = MagicMock()
    settings.trusted_proxies = trusted_proxies
    return settings


def _make_request(*, client_host: str = "10.0.0.1", headers: dict | None = None):
    """Create a mock Starlette Request with the given client host and headers."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = client_host
    request.headers = headers or {}
    # slowapi's get_remote_address reads request.client.host
    return request


# =============================================================================
# _get_trusted_proxies()
# =============================================================================


class TestGetTrustedProxies:
    def test_parses_comma_separated_ips(self):
        with patch(
            "app.core.rate_limit.get_settings", return_value=_make_settings("1.2.3.4,5.6.7.8")
        ):
            exact, networks = _get_trusted_proxies()
        assert exact == frozenset({"1.2.3.4", "5.6.7.8"})
        assert networks == ()

    def test_parses_cidr_ranges(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            exact, networks = _get_trusted_proxies()
        assert exact == frozenset()
        assert len(networks) == 1
        assert str(networks[0]) == "172.16.0.0/12"

    def test_parses_mixed_ips_and_cidrs(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1,::1,172.16.0.0/12"),
        ):
            exact, networks = _get_trusted_proxies()
        assert exact == frozenset({"127.0.0.1", "::1"})
        assert len(networks) == 1

    def test_empty_string(self):
        with patch("app.core.rate_limit.get_settings", return_value=_make_settings("")):
            exact, networks = _get_trusted_proxies()
        assert exact == frozenset()
        assert networks == ()

    def test_handles_whitespace(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("  127.0.0.1 , ::1 , 10.0.0.0/8  "),
        ):
            exact, networks = _get_trusted_proxies()
        assert exact == frozenset({"127.0.0.1", "::1"})
        assert len(networks) == 1

    def test_results_are_cached(self):
        mock_settings = _make_settings("127.0.0.1")
        with patch("app.core.rate_limit.get_settings", return_value=mock_settings) as mock_get:
            _get_trusted_proxies()
            _get_trusted_proxies()
            mock_get.assert_called_once()


# =============================================================================
# _is_trusted_proxy()
# =============================================================================


class TestIsTrustedProxy:
    def test_exact_ip_match(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1,::1"),
        ):
            assert _is_trusted_proxy("127.0.0.1") is True

    def test_non_matching_ip(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1,::1"),
        ):
            assert _is_trusted_proxy("192.168.1.1") is False

    def test_cidr_match(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            assert _is_trusted_proxy("172.18.0.1") is True

    def test_ip_outside_cidr(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            assert _is_trusted_proxy("10.0.0.1") is False

    def test_ipv6_loopback_match(self):
        with patch("app.core.rate_limit.get_settings", return_value=_make_settings("::1")):
            assert _is_trusted_proxy("::1") is True

    def test_invalid_ip_returns_false(self):
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            assert _is_trusted_proxy("not-an-ip") is False


# =============================================================================
# get_client_ip()
# =============================================================================


class TestGetClientIp:
    def test_returns_direct_ip_when_untrusted(self):
        """Untrusted proxy: ignore all headers, return direct connection IP."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1"),
        ):
            request = _make_request(
                client_host="10.0.0.99",
                headers={"X-Real-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8"},
            )
            assert get_client_ip(request) == "10.0.0.99"

    def test_returns_x_real_ip_from_trusted_proxy(self):
        """Trusted proxy: prefer X-Real-IP (set by nginx)."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.18.0.3,172.16.0.0/12"),
        ):
            request = _make_request(
                client_host="172.18.0.3",
                headers={"X-Real-IP": "203.0.113.50"},
            )
            assert get_client_ip(request) == "203.0.113.50"

    def test_ignores_x_real_ip_from_untrusted(self):
        """Untrusted proxy: X-Real-IP must be ignored (client could spoof it)."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1"),
        ):
            request = _make_request(
                client_host="10.0.0.1",
                headers={"X-Real-IP": "1.2.3.4"},
            )
            assert get_client_ip(request) == "10.0.0.1"

    def test_falls_back_to_x_forwarded_for_from_trusted(self):
        """Trusted proxy: fall back to X-Forwarded-For first entry when no X-Real-IP."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            request = _make_request(
                client_host="172.18.0.2",
                headers={"X-Forwarded-For": "198.51.100.42, 172.18.0.1"},
            )
            assert get_client_ip(request) == "198.51.100.42"

    def test_x_forwarded_for_takes_first_entry_only(self):
        """Multi-hop X-Forwarded-For: only the first (client) entry is used."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("172.16.0.0/12"),
        ):
            request = _make_request(
                client_host="172.20.0.1",
                headers={"X-Forwarded-For": "1.2.3.4, 5.6.7.8, 9.10.11.12"},
            )
            assert get_client_ip(request) == "1.2.3.4"

    def test_ignores_x_forwarded_for_from_untrusted(self):
        """Untrusted proxy: X-Forwarded-For must be ignored."""
        with patch(
            "app.core.rate_limit.get_settings",
            return_value=_make_settings("127.0.0.1"),
        ):
            request = _make_request(
                client_host="192.168.1.1",
                headers={"X-Forwarded-For": "1.2.3.4"},
            )
            assert get_client_ip(request) == "192.168.1.1"


# =============================================================================
# get_client_fingerprint()
# =============================================================================


class TestGetClientFingerprint:
    def test_returns_ip_truncated_to_max_length(self):
        long_ip = "a" * 200
        with patch("app.core.rate_limit.get_client_ip", return_value=long_ip):
            result = get_client_fingerprint(MagicMock())
        assert len(result) == MAX_FINGERPRINT_LENGTH
        assert result == long_ip[:MAX_FINGERPRINT_LENGTH]

    def test_normal_ip_unchanged(self):
        with patch("app.core.rate_limit.get_client_ip", return_value="192.168.1.1"):
            result = get_client_fingerprint(MagicMock())
        assert result == "192.168.1.1"


# =============================================================================
# rate_limit_exceeded_handler()
# =============================================================================


class TestRateLimitExceededHandler:
    def _make_exc(self):
        """Create a mock RateLimitExceeded exception."""
        exc = MagicMock()
        exc.detail = "Rate limit exceeded: 5 per 1 minute"
        return exc

    def test_returns_429_status(self):
        response = rate_limit_exceeded_handler(MagicMock(), self._make_exc())
        assert response.status_code == 429

    def test_response_has_detail_and_retry_after(self):
        response = rate_limit_exceeded_handler(MagicMock(), self._make_exc())
        assert isinstance(response, JSONResponse)
        assert response.body is not None
        import json

        body = json.loads(response.body)
        assert "detail" in body
        assert "retry_after" in body

    def test_response_has_retry_after_header(self):
        response = rate_limit_exceeded_handler(MagicMock(), self._make_exc())
        assert "retry-after" in response.headers
