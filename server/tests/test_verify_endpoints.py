"""Integration tests for email verification endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest


def _identify(client: TestClient, fingerprint: str) -> dict:
    """Helper: identify a guest and return {guest_id, cookie}."""
    client.cookies.clear()
    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": fingerprint, "fingerprint_components": {}},
    )
    assert resp.status_code == 200
    return {
        "guest_id": resp.json()["guest_id"],
        "cookie": resp.cookies.get("wrzdj_guest"),
    }


def test_request_code_returns_sent(client: TestClient, db: Session):
    """POST /verify/request -> 200 with {sent: true}."""
    guest = _identify(client, "verify_test_fp_1")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        resp = client.post(
            "/api/public/guest/verify/request",
            json={"email": "test@example.com", "turnstile_token": "test-token"},
        )
    assert resp.status_code == 200
    assert resp.json()["sent"] is True


def test_request_code_without_cookie_fails(client: TestClient):
    """No wrzdj_guest cookie -> error."""
    client.cookies.clear()
    resp = client.post(
        "/api/public/guest/verify/request",
        json={"email": "test@example.com", "turnstile_token": "test-token"},
    )
    assert resp.status_code in (400, 401)


def test_confirm_code_sets_email_on_guest(client: TestClient, db: Session):
    """Correct code -> email on Guest row."""
    guest_info = _identify(client, "verify_test_fp_2")
    client.cookies.set("wrzdj_guest", guest_info["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "verified@test.com", "turnstile_token": "test-token"},
        )

    from app.models.email_verification_code import EmailVerificationCode

    code_row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == guest_info["guest_id"])
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    assert code_row is not None

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "verified@test.com", "code": code_row.code},
    )
    assert resp.status_code == 200
    assert resp.json()["verified"] is True

    guest = db.query(Guest).filter(Guest.id == guest_info["guest_id"]).one()
    assert guest.email_verified_at is not None


def test_confirm_code_returns_merged_true(client: TestClient, db: Session):
    """Second device verifies same email -> {merged: true}, new cookie."""
    # Device A
    device_a = _identify(client, "merge_device_a_fp")
    client.cookies.set("wrzdj_guest", device_a["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "shared@test.com", "turnstile_token": "test-token"},
        )

    from app.models.email_verification_code import EmailVerificationCode

    code_a = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == device_a["guest_id"])
        .first()
    )
    client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "shared@test.com", "code": code_a.code},
    )

    # Device B
    device_b = _identify(client, "merge_device_b_fp")
    client.cookies.set("wrzdj_guest", device_b["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "shared@test.com", "turnstile_token": "test-token"},
        )

    code_b = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == device_b["guest_id"])
        .first()
    )
    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "shared@test.com", "code": code_b.code},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["merged"] is True
    assert data["guest_id"] == device_a["guest_id"]


def test_confirm_wrong_code_returns_error(client: TestClient, db: Session):
    """Wrong code -> 400."""
    guest = _identify(client, "wrong_code_fp")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "wrong@test.com", "turnstile_token": "test-token"},
        )

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "wrong@test.com", "code": "000000"},
    )
    assert resp.status_code == 400
