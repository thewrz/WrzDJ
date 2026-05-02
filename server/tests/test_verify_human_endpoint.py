"""Tests for POST /api/guest/verify-human."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.services.human_verification import COOKIE_NAME


def _create_guest(db: Session, token: str = "test-guest-token") -> Guest:
    guest = Guest(token=token)
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


class TestVerifyHumanEndpoint:
    @patch(
        "app.api.guest.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_success_sets_cookie(self, mock_turnstile, client: TestClient, db: Session):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post(
            "/api/public/guest/verify-human",
            json={"turnstile_token": "fake-token"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["verified"] is True
        assert body["expires_in"] == 3600
        assert COOKIE_NAME in response.cookies

    @patch(
        "app.api.guest.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=False,
    )
    def test_invalid_turnstile_token_400(self, mock_turnstile, client: TestClient, db: Session):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post(
            "/api/public/guest/verify-human",
            json={"turnstile_token": "bad-token"},
        )
        assert response.status_code == 400
        assert "CAPTCHA" in response.json()["detail"]
        assert COOKIE_NAME not in response.cookies

    def test_missing_guest_cookie_400(self, client: TestClient, db: Session):
        # No wrzdj_guest cookie set
        response = client.post(
            "/api/public/guest/verify-human",
            json={"turnstile_token": "any"},
        )
        assert response.status_code == 400
        assert "Guest" in response.json()["detail"]

    def test_missing_token_field_422(self, client: TestClient, db: Session):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post("/api/public/guest/verify-human", json={})
        assert response.status_code == 422
