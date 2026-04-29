from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.encryption import EncryptedText
from app.core.time import utcnow
from app.models.base import Base


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    fingerprint_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    fingerprint_components: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    verified_email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    email_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
