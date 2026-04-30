"""Integration tests for POST /api/public/guest/identify."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.guest import Guest


def test_identify_sets_cookie(client: TestClient):
    """Response includes Set-Cookie with correct attributes."""
    resp = client.post(
        "/api/public/guest/identify",
        json={
            "fingerprint_hash": "test_fp_cookie_check",
            "fingerprint_components": {"screen": "1170x2532"},
        },
    )
    assert resp.status_code == 200
    assert "guest_id" in resp.json()

    cookie = resp.cookies.get("wrzdj_guest")
    assert cookie is not None
    assert len(cookie) == 64

    set_cookie_header = resp.headers.get("set-cookie", "")
    assert "httponly" in set_cookie_header.lower()
    assert "path=/api/" in set_cookie_header.lower()


def test_identify_with_cookie_returns_same_guest(client: TestClient):
    """Second call with cookie -> same guest_id, no new row."""
    resp1 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_same_guest"},
    )
    guest_id_1 = resp1.json()["guest_id"]
    cookie_val = resp1.cookies["wrzdj_guest"]

    client.cookies.set("wrzdj_guest", cookie_val)
    resp2 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_same_guest"},
    )
    guest_id_2 = resp2.json()["guest_id"]

    assert guest_id_1 == guest_id_2


def test_identify_without_cookie_reconciles(client: TestClient, db: Session):
    """Second call without cookie but with same fingerprint, after the quiet period
    has elapsed -> same guest (reconcile)."""
    _chrome_ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"
    resp1 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_reconcile"},
        headers={"User-Agent": _chrome_ua},
    )
    guest_id_1 = resp1.json()["guest_id"]

    # Backdate so the guest is outside the 12-hour concurrent-activity window
    g = db.query(Guest).filter(Guest.id == guest_id_1).one()
    g.last_seen_at = utcnow() - timedelta(hours=13)
    db.commit()

    client.cookies.clear()
    resp2 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_reconcile"},
        headers={"User-Agent": _chrome_ua},
    )
    guest_id_2 = resp2.json()["guest_id"]

    assert guest_id_1 == guest_id_2
    assert resp2.json().get("action") == "reconcile"


def test_identify_invalid_fingerprint_format(client: TestClient):
    """Malformed fingerprint_hash -> 422."""
    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "short"},
    )
    assert resp.status_code == 422


def test_identify_missing_body(client: TestClient):
    """No body -> 422."""
    resp = client.post("/api/public/guest/identify")
    assert resp.status_code == 422


def test_identify_response_includes_action_create_then_cookie_hit(client):
    """F6 — response body must carry the action so the frontend can
    detect first-time creates without inspecting Set-Cookie (which is
    a forbidden cross-origin response header)."""
    first = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_action_test_1", "fingerprint_components": {}},
    )
    assert first.status_code == 200
    body = first.json()
    assert "guest_id" in body
    assert body.get("action") == "create"

    # Same client (cookie persisted) hits identify again
    second = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_action_test_1", "fingerprint_components": {}},
    )
    assert second.status_code == 200
    assert second.json().get("action") == "cookie_hit"
    assert second.json().get("guest_id") == body["guest_id"]
