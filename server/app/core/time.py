"""UTC datetime utilities.

Replaces deprecated ``datetime.utcnow()`` with a non-deprecated equivalent
that still returns **naive** UTC datetimes (no tzinfo), compatible with
SQLAlchemy ``DateTime`` columns (both SQLite and PostgreSQL without
``timezone=True``).
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Return the current UTC time as a naive datetime."""
    return datetime.now(UTC).replace(tzinfo=None)
