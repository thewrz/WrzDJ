from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class GuestProfile(Base):
    __tablename__ = "guest_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[int | None] = mapped_column(
        ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    nickname: Mapped[str | None] = mapped_column(String(30), nullable=True)
    submission_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "guest_id",
            name="uq_guest_profile_event_guest",
        ),
        # Functional unique index: case-insensitive nickname uniqueness per event.
        # Created by migration 040_add_nickname_uniqueness via raw op.execute().
        # This Index() annotation exists solely to suppress alembic autogenerate drift —
        # without it, alembic sees the DB index but not the model and generates a spurious
        # remove_index operation. Do NOT remove it.
        Index(
            "uq_guest_profile_event_nickname",
            "event_id",
            func.lower(Column("nickname")),
            unique=True,
            postgresql_where=text("nickname IS NOT NULL"),
        ),
    )
