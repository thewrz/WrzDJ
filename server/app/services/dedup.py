"""Shared deduplication service for song requests.

Single source of truth for dedupe key computation and duplicate detection.
Both the join-page (request.py) and collect (collect.py) flows import from here.
"""

import hashlib
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.request import Request


def compute_dedupe_key(artist: str, title: str) -> str:
    """Compute a deduplication key from normalized artist and title."""
    normalized = f"{artist.lower().strip()}:{title.lower().strip()}"
    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


def find_duplicate(
    db: Session,
    event_id: int,
    artist: str,
    title: str,
    window_hours: int = 6,
) -> Request | None:
    """Find an existing request with the same artist+title within the time window."""
    dedupe_key = compute_dedupe_key(artist, title)
    cutoff = utcnow() - timedelta(hours=window_hours)
    return (
        db.query(Request)
        .filter(
            Request.event_id == event_id,
            Request.dedupe_key == dedupe_key,
            Request.created_at > cutoff,
        )
        .first()
    )
