"""Tests for the Turnstile gate on POST /api/public/guest/verify/request."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest


def _setup_guest(db: Session, client: TestClient) -> Guest:
    guest = Guest(token="otp-test-guest")
    db.add(guest)
    db.commit()
    client.cookies.set("wrzdj_guest", guest.token)
    return guest


class TestOtpTurnstileGate:
    @patch(
        "app.api.verify.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    @patch("app.api.verify.create_verification_code")
    def test_valid_token_proceeds(
        self, mock_create, mock_turnstile, client: TestClient, db: Session
    ):
        _setup_guest(db, client)

        response = client.post(
            "/api/public/guest/verify/request",
            json={"email": "test@example.com", "turnstile_token": "valid"},
        )
        assert response.status_code == 200
        mock_turnstile.assert_called_once()
        mock_create.assert_called_once()

    @patch(
        "app.api.verify.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=False,
    )
    def test_invalid_token_400(self, mock_turnstile, client: TestClient, db: Session):
        _setup_guest(db, client)

        response = client.post(
            "/api/public/guest/verify/request",
            json={"email": "test@example.com", "turnstile_token": "bad"},
        )
        assert response.status_code == 400
        assert "CAPTCHA" in response.json()["detail"]

    def test_missing_token_field_422(self, client: TestClient, db: Session):
        _setup_guest(db, client)

        response = client.post(
            "/api/public/guest/verify/request",
            json={"email": "test@example.com"},
        )
        assert response.status_code == 422

    def test_token_validated_before_guest_check(self, client: TestClient, db: Session):
        """Order check: bad Turnstile should 400 even when guest cookie missing.

        This prevents leaking 'is there a guest with this cookie' via timing.
        """
        # No guest cookie set
        with patch(
            "app.api.verify.verify_turnstile_token",
            new_callable=AsyncMock,
            return_value=False,
        ):
            response = client.post(
                "/api/public/guest/verify/request",
                json={"email": "test@example.com", "turnstile_token": "bad"},
            )
        assert response.status_code == 400
        assert "CAPTCHA" in response.json()["detail"]
