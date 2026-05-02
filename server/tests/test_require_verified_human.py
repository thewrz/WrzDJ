"""Tests for the require_verified_human FastAPI dependency."""

from fastapi import HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import require_verified_human
from app.models.guest import Guest
from app.services.human_verification import COOKIE_NAME, issue_human_cookie


def _build_request(cookies: dict[str, str]) -> Request:
    """Build a minimal FastAPI Request with the given cookies."""
    if cookies:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers = [(b"cookie", cookie_header.encode())]
    else:
        headers = []
    scope = {
        "type": "http",
        "headers": headers,
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    return Request(scope)


def _issue_cookie_value(guest_id: int) -> str:
    """Issue a cookie via the real helper and extract just the cookie value."""
    response = Response()
    issue_human_cookie(response, guest_id)
    set_cookie = response.headers.get("set-cookie")
    return set_cookie.split("=", 1)[1].split(";", 1)[0]


class TestRequireVerifiedHuman:
    def test_valid_cookies_returns_guest_id_and_refreshes(self, db: Session):
        guest = Guest(token="guest-A")
        db.add(guest)
        db.commit()
        cookie_value = _issue_cookie_value(guest.id)

        request = _build_request({"wrzdj_guest": guest.token, COOKIE_NAME: cookie_value})
        response = Response()

        result = require_verified_human(request, response, db)
        assert result == guest.id
        # Sliding refresh: new cookie set on the response
        new_set_cookie = response.headers.get("set-cookie")
        assert new_set_cookie is not None
        assert COOKIE_NAME in new_set_cookie

    def test_missing_human_cookie_returns_403(self, db: Session):
        guest = Guest(token="guest-B")
        db.add(guest)
        db.commit()

        # Only wrzdj_guest, no wrzdj_human
        request = _build_request({"wrzdj_guest": guest.token})
        response = Response()

        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403
            assert isinstance(exc.detail, dict)
            assert exc.detail["code"] == "human_verification_required"

    def test_missing_guest_cookie_returns_403(self, db: Session):
        # Cookie minted for some guest but no guest cookie sent
        cookie_value = _issue_cookie_value(99)

        request = _build_request({COOKIE_NAME: cookie_value})
        response = Response()

        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403

    def test_mismatched_guest_id_returns_403(self, db: Session):
        # Guest A exists in DB
        guest_a = Guest(token="guest-A2")
        db.add(guest_a)
        db.commit()

        # But wrzdj_human cookie was minted for a different guest_id (99)
        cookie_value = _issue_cookie_value(99)

        request = _build_request({"wrzdj_guest": guest_a.token, COOKIE_NAME: cookie_value})
        response = Response()

        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403

    def test_invalid_human_cookie_returns_403(self, db: Session):
        guest = Guest(token="guest-C")
        db.add(guest)
        db.commit()

        # Garbage cookie value
        request = _build_request({"wrzdj_guest": guest.token, COOKIE_NAME: "not-a-valid-cookie"})
        response = Response()

        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403
