"""Tests for orphan GuestProfile linking after email verification.

Bug context: A profile created before the wrzdj_guest cookie is set has
guest_id=NULL. Email verification only updated guests.verified_email but
never backfilled guest_profiles.guest_id. This left "orphan" profiles
unlinked to the verified guest.

These tests pin down the new reconciliation behavior in two layers:
- collect.py: get_profile / upsert_profile reconcile orphans by fingerprint
- email_verification.py: confirm_verification_code links orphans by IP
"""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.services import collect as collect_service

# ---------------------------------------------------------------------------
# Layer B: services/collect.py — get_profile / upsert_profile reconciliation
# ---------------------------------------------------------------------------


def test_get_profile_falls_back_to_fingerprint_when_guest_id_misses(db: Session, test_event: Event):
    """When called with both guest_id and fingerprint, an orphan profile
    keyed only by fingerprint should be returned (current code returns None).
    """
    orphan = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="1.2.3.4",
        guest_id=None,
        nickname="alice",
    )
    db.add(orphan)
    db.commit()
    db.refresh(orphan)

    result = collect_service.get_profile(
        db, event_id=test_event.id, fingerprint="1.2.3.4", guest_id=42
    )

    assert result is not None
    assert result.id == orphan.id


def test_upsert_profile_backfills_guest_id_on_orphan_match(db: Session, test_event: Event):
    """upsert_profile reuses an orphan row matched by fingerprint and
    backfills the missing guest_id rather than creating a duplicate."""
    orphan = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="1.2.3.4",
        guest_id=None,
        nickname="alice",
    )
    db.add(orphan)
    db.commit()
    orphan_id = orphan.id

    result = collect_service.upsert_profile(
        db,
        event_id=test_event.id,
        fingerprint="1.2.3.4",
        guest_id=42,
        nickname="alice",
    )

    assert result.id == orphan_id
    assert result.guest_id == 42
    assert result.nickname == "alice"

    total = db.query(GuestProfile).filter(GuestProfile.event_id == test_event.id).count()
    assert total == 1


def test_upsert_profile_does_not_overwrite_existing_guest_id(db: Session, test_event: Event):
    """If a profile already has a non-null guest_id, upsert with a different
    guest_id from the same fingerprint must NOT overwrite. Fingerprint
    (IP) is approximate; guest_id is authoritative."""
    profile = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="1.2.3.4",
        guest_id=42,
        nickname="alice",
    )
    db.add(profile)
    db.commit()

    result = collect_service.upsert_profile(
        db,
        event_id=test_event.id,
        fingerprint="1.2.3.4",
        guest_id=99,
    )

    assert result.guest_id == 42


# ---------------------------------------------------------------------------
# Layer A: confirm_verification_code links orphans by request fingerprint
# ---------------------------------------------------------------------------


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


def _send_and_get_code(client: TestClient, db: Session, *, guest_id: int, email: str) -> str:
    from app.models.email_verification_code import EmailVerificationCode

    with patch("app.services.email_verification.send_verification_email"):
        resp = client.post(
            "/api/public/guest/verify/request",
            json={"email": email},
        )
    assert resp.status_code == 200, resp.text
    row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == guest_id)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    assert row is not None
    return row.code


def test_confirm_verification_code_backfills_orphan_profile_by_fingerprint(
    client: TestClient, db: Session, test_event: Event
):
    """After /verify/confirm, an orphan profile with client_fingerprint
    matching the request IP must be linked to the verifying guest."""
    info = _identify(client, "fp_orphan_link_1")
    request_ip = "testclient"  # TestClient's default direct IP

    orphan = GuestProfile(
        event_id=test_event.id,
        client_fingerprint=request_ip,
        guest_id=None,
        nickname="orphana",
    )
    db.add(orphan)
    db.commit()
    orphan_id = orphan.id

    client.cookies.set("wrzdj_guest", info["cookie"])
    code = _send_and_get_code(client, db, guest_id=info["guest_id"], email="orphana@test.com")

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "orphana@test.com", "code": code},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["verified"] is True

    db.expire_all()
    profile = db.query(GuestProfile).filter(GuestProfile.id == orphan_id).one()
    assert profile.guest_id == info["guest_id"]

    guest = db.query(Guest).filter(Guest.id == info["guest_id"]).one()
    assert guest.email_verified_at is not None


def test_confirm_verification_code_does_not_link_orphans_with_different_fingerprint(
    client: TestClient, db: Session, test_event: Event
):
    """Only orphans with matching client_fingerprint should be linked."""
    info = _identify(client, "fp_orphan_link_2")
    request_ip = "testclient"

    matching = GuestProfile(
        event_id=test_event.id,
        client_fingerprint=request_ip,
        guest_id=None,
        nickname="match",
    )
    other = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="9.9.9.9",
        guest_id=None,
        nickname="other",
    )
    db.add_all([matching, other])
    db.commit()
    matching_id = matching.id
    other_id = other.id

    client.cookies.set("wrzdj_guest", info["cookie"])
    code = _send_and_get_code(client, db, guest_id=info["guest_id"], email="onlymatch@test.com")

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "onlymatch@test.com", "code": code},
    )
    assert resp.status_code == 200

    db.expire_all()
    matched_row = db.query(GuestProfile).filter(GuestProfile.id == matching_id).one()
    other_row = db.query(GuestProfile).filter(GuestProfile.id == other_id).one()
    assert matched_row.guest_id == info["guest_id"]
    assert other_row.guest_id is None


# ---------------------------------------------------------------------------
# Integration: full collect flow shows email_verified=True after backfill
# ---------------------------------------------------------------------------


def test_email_verified_flag_reflects_orphan_profile_after_verify(
    client: TestClient, db: Session, test_event: Event
):
    """End-to-end: orphan profile + identify + verify -> GET /profile
    returns email_verified=True (currently False because guest_id stays NULL)."""
    request_ip = "testclient"

    orphan = GuestProfile(
        event_id=test_event.id,
        client_fingerprint=request_ip,
        guest_id=None,
        nickname="endtoend",
    )
    db.add(orphan)
    db.commit()

    info = _identify(client, "fp_e2e_orphan")
    client.cookies.set("wrzdj_guest", info["cookie"])

    code = _send_and_get_code(client, db, guest_id=info["guest_id"], email="e2e@test.com")
    confirm = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "e2e@test.com", "code": code},
    )
    assert confirm.status_code == 200

    resp = client.get(f"/api/public/collect/{test_event.code}/profile")
    assert resp.status_code == 200
    body = resp.json()
    assert body["email_verified"] is True
    assert body["nickname"] == "endtoend"


def test_set_profile_post_does_not_crash_on_pre_existing_orphan(
    client: TestClient, db: Session, test_event: Event
):
    """Regression: when a fingerprint-orphan exists, POST /profile from a
    new cookie session must reuse it (no IntegrityError on the unique
    constraint uq_guest_profile_event_fingerprint)."""
    request_ip = "testclient"

    orphan = GuestProfile(
        event_id=test_event.id,
        client_fingerprint=request_ip,
        guest_id=None,
        nickname=None,
    )
    db.add(orphan)
    db.commit()
    orphan_id = orphan.id

    info = _identify(client, "fp_regression_orphan")
    client.cookies.set("wrzdj_guest", info["cookie"])

    resp = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "linked"},
    )
    assert resp.status_code == 200, resp.text

    db.expire_all()
    rows = db.query(GuestProfile).filter(GuestProfile.event_id == test_event.id).all()
    assert len(rows) == 1
    assert rows[0].id == orphan_id
    assert rows[0].guest_id == info["guest_id"]
    assert rows[0].nickname == "linked"
