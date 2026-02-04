from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class RequestStatus(str, Enum):
    NEW = "new"
    PLAYING = "playing"
    PLAYED = "played"
    REJECTED = "rejected"


class RequestSource(str, Enum):
    MANUAL = "manual"
    MUSICBRAINZ = "musicbrainz"
    SHARE_LINK = "share_link"


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    song_title: Mapped[str] = mapped_column(String(255))
    artist: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(20), default=RequestSource.MANUAL.value)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=RequestStatus.NEW.value, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    client_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), index=True)

    event: Mapped["Event"] = relationship("Event", back_populates="requests")
