"""Assert no IP-derived columns or attributes exist on models or DB schema.

These tests guard against re-introducing IP storage. They FAIL on the
pre-cleanup codebase and PASS after the cleanup is complete.

See: docs/RECOVERY-IP-IDENTITY.md
"""

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.models.request import Request
from app.models.request_vote import RequestVote


def test_request_model_no_client_fingerprint_attr():
    assert not hasattr(Request, "client_fingerprint"), (
        "Request.client_fingerprint must not exist — see docs/RECOVERY-IP-IDENTITY.md"
    )


def test_request_vote_model_no_client_fingerprint_attr():
    assert not hasattr(RequestVote, "client_fingerprint"), (
        "RequestVote.client_fingerprint must not exist — see docs/RECOVERY-IP-IDENTITY.md"
    )


def test_guest_profile_model_no_client_fingerprint_attr():
    assert not hasattr(GuestProfile, "client_fingerprint"), (
        "GuestProfile.client_fingerprint must not exist — see docs/RECOVERY-IP-IDENTITY.md"
    )


def test_guest_model_no_ip_address_attr():
    assert not hasattr(Guest, "ip_address"), (
        "Guest.ip_address must not exist — see docs/RECOVERY-IP-IDENTITY.md"
    )


def test_db_schema_has_no_ip_columns(db: Session):
    """Reflect the live test-DB schema; no IP-derived columns may exist."""
    inspector = inspect(db.get_bind())
    forbidden = [
        ("requests", "client_fingerprint"),
        ("request_votes", "client_fingerprint"),
        ("guest_profiles", "client_fingerprint"),
        ("guests", "ip_address"),
    ]
    for table, col in forbidden:
        cols = {c["name"] for c in inspector.get_columns(table)}
        assert col not in cols, f"{table}.{col} must not exist — see docs/RECOVERY-IP-IDENTITY.md"
