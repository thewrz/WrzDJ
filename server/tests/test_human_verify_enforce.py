"""Tests for human-verification enforcement on gated endpoints.

Soft-mode default is False; tests here flip enforce=True and confirm 403.
"""

from fastapi import Response
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.guest import Guest
from app.models.system_settings import SystemSettings
from app.services.human_verification import COOKIE_NAME, issue_human_cookie


def _issue_cookie_value(guest_id: int) -> str:
    """Issue a cookie via the real helper and extract just the cookie value."""
    response = Response()
    issue_human_cookie(response, guest_id)
    set_cookie = response.headers.get("set-cookie")
    return set_cookie.split("=", 1)[1].split(";", 1)[0]


def _setup_enforced(db: Session, enforced: bool = True) -> None:
    sys_settings = db.query(SystemSettings).filter_by(id=1).first()
    if sys_settings is None:
        sys_settings = SystemSettings(id=1, human_verification_enforced=enforced)
        db.add(sys_settings)
    else:
        sys_settings.human_verification_enforced = enforced
    db.commit()


class TestEnforceModeBlocksWithoutCookie:
    def test_submit_request_403_when_enforced_and_no_human_cookie(
        self, client: TestClient, db: Session, test_event: Event
    ):
        _setup_enforced(db, enforced=True)
        guest = Guest(token="enforce-test-1")
        db.add(guest)
        db.commit()
        client.cookies.set("wrzdj_guest", guest.token)
        # No wrzdj_human cookie

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "title": "Test",
                "artist": "Test",
                "source": "spotify",
                "source_url": "https://open.spotify.com/track/x",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "human_verification_required"

    def test_submit_request_passes_when_enforced_and_human_cookie_valid(
        self, client: TestClient, db: Session, test_event: Event
    ):
        _setup_enforced(db, enforced=True)
        guest = Guest(token="enforce-test-2")
        db.add(guest)
        db.commit()
        client.cookies.set("wrzdj_guest", guest.token)
        client.cookies.set(COOKIE_NAME, _issue_cookie_value(guest.id))

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "title": "Test2",
                "artist": "Test2",
                "source": "spotify",
                "source_url": "https://open.spotify.com/track/y",
            },
        )
        # 200 or 201 depending on duplicate/new
        assert response.status_code in (200, 201)

    def test_submit_request_passes_when_not_enforced_and_no_human_cookie(
        self, client: TestClient, db: Session, test_event: Event
    ):
        _setup_enforced(db, enforced=False)
        guest = Guest(token="enforce-test-3")
        db.add(guest)
        db.commit()
        client.cookies.set("wrzdj_guest", guest.token)
        # No wrzdj_human cookie — soft mode passes through

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "title": "Test3",
                "artist": "Test3",
                "source": "spotify",
                "source_url": "https://open.spotify.com/track/z",
            },
        )
        assert response.status_code in (200, 201)
