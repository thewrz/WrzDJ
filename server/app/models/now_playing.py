"""NowPlaying model - mutable singleton per event for current track."""
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


def utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


class NowPlaying(Base):
    """
    Stores the ONE currently-playing track for an event.
    Upserted on each bridge POST. Only one row per event_id at any time.
    """

    __tablename__ = "now_playing"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), unique=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    artist: Mapped[str] = mapped_column(String(255))
    album: Mapped[str | None] = mapped_column(String(255), nullable=True)
    deck: Mapped[str | None] = mapped_column(String(10), nullable=True)
    spotify_track_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    album_art_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    spotify_uri: Mapped[str | None] = mapped_column(String(100), nullable=True)
    matched_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("requests.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(20), default="manual")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    bridge_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    bridge_device_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bridge_last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    event: Mapped["Event"] = relationship("Event", foreign_keys=[event_id])
    matched_request: Mapped["Request | None"] = relationship(
        "Request", foreign_keys=[matched_request_id]
    )
