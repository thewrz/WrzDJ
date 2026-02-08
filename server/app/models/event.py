from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    now_playing_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("requests.id", ondelete="SET NULL"), nullable=True
    )
    now_playing_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Tidal playlist sync
    tidal_playlist_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tidal_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    # Custom banner image
    banner_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    banner_colors: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped["User"] = relationship("User", back_populates="events")
    requests: Mapped[list["Request"]] = relationship(
        "Request", back_populates="event", foreign_keys="Request.event_id"
    )
    now_playing: Mapped["Request | None"] = relationship(
        "Request", foreign_keys=[now_playing_request_id], post_update=True
    )
    play_history: Mapped[list["PlayHistory"]] = relationship("PlayHistory", back_populates="event")
