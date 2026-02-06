from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PlaySource(str, Enum):
    MANUAL = "manual"
    STAGELINQ = "stagelinq"


class PlayHistory(Base):
    __tablename__ = "play_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    artist: Mapped[str] = mapped_column(String(255))
    album_art_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default=PlaySource.MANUAL.value)
    source_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("requests.id"), nullable=True, index=True
    )
    played_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event: Mapped["Event"] = relationship("Event", back_populates="play_history")
    source_request: Mapped["Request | None"] = relationship("Request", foreign_keys=[source_request_id])

    __table_args__ = (
        Index("ix_play_history_event_played", "event_id", "played_at"),
    )
