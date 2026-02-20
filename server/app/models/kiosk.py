from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class Kiosk(Base):
    __tablename__ = "kiosks"

    id: Mapped[int] = mapped_column(primary_key=True)
    pair_code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    session_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    event_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    paired_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pairing")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    paired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pair_expires_at: Mapped[datetime] = mapped_column(DateTime)
