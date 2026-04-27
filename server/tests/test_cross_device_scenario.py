"""Scenario tests for cross-device email merge."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.email_verification_code import EmailVerificationCode
from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.request_vote import RequestVote


def _identify(client: TestClient, fingerprint: str) -> dict:
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


def _verify_email(client: TestClient, db: Session, guest_id: int, cookie: str, email: str):
    """Helper: request code + confirm it."""
    client.cookies.set("wrzdj_guest", cookie)
    with patch("app.services.email_verification.send_verification_email"):
        client.post("/api/public/guest/verify/request", json={"email": email})
    code_row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == guest_id)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": email, "code": code_row.code},
    )
    return resp.json()


def test_two_devices_same_email_merge(
    client: TestClient, db: Session, test_event: Event, auth_headers: dict
):
    """Phone submits 3 songs, laptop verifies same email -> merged into phone guest."""
    phone = _identify(client, "phone_fp_merge")
    client.cookies.set("wrzdj_guest", phone["cookie"])

    for i in range(3):
        client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": f"Artist {i}", "title": f"Song {i}", "source": "manual"},
        )

    _verify_email(client, db, phone["guest_id"], phone["cookie"], "merge@test.com")

    laptop = _identify(client, "laptop_fp_merge")
    result = _verify_email(client, db, laptop["guest_id"], laptop["cookie"], "merge@test.com")

    assert result["merged"] is True
    assert result["guest_id"] == phone["guest_id"]


def test_merge_dedup_same_vote(client: TestClient, db: Session, test_event: Event):
    """Both devices voted on same song -> one vote after merge."""
    phone = _identify(client, "phone_fp_vote")
    laptop = _identify(client, "laptop_fp_vote")

    req = Request(
        event_id=test_event.id,
        song_title="Shared Vote Song",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_shared_vote",
        vote_count=2,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    db.add(
        RequestVote(
            request_id=req.id, guest_id=phone["guest_id"], client_fingerprint="phone_fp_vote"
        )
    )
    db.add(
        RequestVote(
            request_id=req.id, guest_id=laptop["guest_id"], client_fingerprint="laptop_fp_vote"
        )
    )
    db.commit()

    _verify_email(client, db, phone["guest_id"], phone["cookie"], "voter@test.com")
    result = _verify_email(client, db, laptop["guest_id"], laptop["cookie"], "voter@test.com")

    assert result["merged"] is True

    db.refresh(req)
    assert req.vote_count == 1

    vote_count = db.query(RequestVote).filter(RequestVote.request_id == req.id).count()
    assert vote_count == 1


def test_unverified_guest_unaffected(client: TestClient, db: Session, test_event: Event):
    """Guest without email -> no merge, works as before."""
    guest = _identify(client, "no_email_fp")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "no_email_fp", "fingerprint_components": {}},
    )
    assert resp.status_code == 200
    assert resp.json()["guest_id"] == guest["guest_id"]
