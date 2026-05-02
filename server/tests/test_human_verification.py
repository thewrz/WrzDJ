"""Tests for human-verification cookie sign/verify."""

import base64
from datetime import UTC, datetime
from unittest.mock import patch

from fastapi import Request, Response

from app.services.human_verification import (
    COOKIE_NAME,
    issue_human_cookie,
    verify_human_cookie,
)


def _make_request_with_cookie(cookie_value: str | None = None) -> Request:
    """Build a minimal Request with a wrzdj_human cookie."""
    cookies = {COOKIE_NAME: cookie_value} if cookie_value else {}
    scope = {
        "type": "http",
        "headers": [],
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    request = Request(scope)
    request._cookies = cookies  # bypass parsing
    return request


@patch("app.services.human_verification.get_settings")
class TestIssueHumanCookie:
    def test_sets_cookie_with_signed_payload(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert set_cookie is not None
        assert COOKIE_NAME in set_cookie
        assert "HttpOnly" in set_cookie
        assert "samesite=lax" in set_cookie.lower()
        assert "Path=/api/" in set_cookie
        assert "Max-Age=3600" in set_cookie

    def test_secure_flag_in_production(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = True
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert "Secure" in set_cookie

    def test_no_secure_flag_in_dev(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert "Secure" not in set_cookie


@patch("app.services.human_verification.get_settings")
class TestVerifyHumanCookie:
    def _issue_and_extract(self, mock_settings, guest_id: int = 42) -> str:
        """Issue a cookie and return its raw value for use in a fresh request."""
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=guest_id)
        set_cookie = response.headers.get("set-cookie")
        # Parse the cookie value (everything between '=' and ';')
        value = set_cookie.split("=", 1)[1].split(";", 1)[0]
        return value

    def test_valid_cookie_returns_guest_id(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        request = _make_request_with_cookie(cookie_value)

        result = verify_human_cookie(request)
        assert result == 42

    def test_missing_cookie_returns_none(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        request = _make_request_with_cookie(None)

        result = verify_human_cookie(request)
        assert result is None

    def test_tampered_signature_returns_none(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        # Flip a character in the signature portion (after the '.')
        payload, sig = cookie_value.rsplit(".", 1)
        bad_sig = "A" + sig[1:] if sig[0] != "A" else "B" + sig[1:]
        tampered = f"{payload}.{bad_sig}"
        request = _make_request_with_cookie(tampered)

        result = verify_human_cookie(request)
        assert result is None

    def test_tampered_payload_returns_none(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        payload, sig = cookie_value.rsplit(".", 1)
        # Decode payload, change guest_id, re-encode WITHOUT updating sig
        decoded = base64.urlsafe_b64decode(payload + "==")
        tampered_payload_bytes = decoded.replace(b'"guest_id":42', b'"guest_id":99')
        tampered_payload = base64.urlsafe_b64encode(tampered_payload_bytes).decode().rstrip("=")
        tampered = f"{tampered_payload}.{sig}"
        request = _make_request_with_cookie(tampered)

        result = verify_human_cookie(request)
        assert result is None

    def test_expired_cookie_returns_none(self, mock_settings):
        """A cookie whose exp is in the past returns None."""
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        # Issue cookie at a fixed past timestamp
        past = datetime(2000, 1, 1, tzinfo=UTC)
        with patch("app.services.human_verification.utcnow", return_value=past):
            response = Response()
            issue_human_cookie(response, guest_id=42)
            set_cookie = response.headers.get("set-cookie")
            cookie_value = set_cookie.split("=", 1)[1].split(";", 1)[0]

        # Verify under real (current) time — exp is far in the past
        request = _make_request_with_cookie(cookie_value)
        result = verify_human_cookie(request)
        assert result is None

    def test_guest_id_must_be_strict_int(self, mock_settings):
        """Cookies with bool, str, or float guest_id are rejected."""
        import json as _json

        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        from app.services.human_verification import _b64encode, _sign

        key = b"x" * 32
        for bad_value in [True, False, "42", 42.5, [42], {"id": 42}, None]:
            payload = {"guest_id": bad_value, "exp": 9999999999}
            payload_bytes = _json.dumps(payload, separators=(",", ":")).encode()
            sig = _sign(payload_bytes, key)
            cookie_value = f"{_b64encode(payload_bytes)}.{_b64encode(sig)}"

            request = _make_request_with_cookie(cookie_value)
            assert verify_human_cookie(request) is None, f"bad value {bad_value!r} was accepted"

    def test_validly_signed_non_json_payload_returns_none(self, mock_settings):
        """A signed payload that isn't valid JSON returns None (not 500)."""
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        from app.services.human_verification import _b64encode, _sign

        key = b"x" * 32
        # Sign garbage bytes — sig check passes, json.loads fails
        garbage = b"not-valid-json-at-all"
        sig = _sign(garbage, key)
        cookie_value = f"{_b64encode(garbage)}.{_b64encode(sig)}"

        request = _make_request_with_cookie(cookie_value)
        assert verify_human_cookie(request) is None

    def test_malformed_cookie_returns_none(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32

        for bad in ["", "no-dot", "only.one.dot.too.many", "...", "abc.def"]:
            request = _make_request_with_cookie(bad)
            assert verify_human_cookie(request) is None
