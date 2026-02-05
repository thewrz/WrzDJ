"""PlayHistory model - append-only log of all tracks played during an event."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.now_playing import utcnow


class PlayHistory(Base):
    """
    One row per track played during an event.
    Never updated or deleted during normal operation.
    """

    __tablename__ = "play_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
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
    source: Mapped[str] = mapped_column(String(20), default="stagelinq")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    play_order: Mapped[int] = mapped_column(Integer)

    # Relationships
    event: Mapped["Event"] = relationship("Event", foreign_keys=[event_id])
    matched_request: Mapped["Request | None"] = relationship(
        "Request", foreign_keys=[matched_request_id]
    )
