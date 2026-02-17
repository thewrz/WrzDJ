import json
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.encryption import EncryptedText
from app.core.time import utcnow
from app.models.base import Base


class UserRole(str, Enum):
    ADMIN = "admin"
    DJ = "dj"
    PENDING = "pending"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String(20), default=UserRole.DJ.value, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # Tidal OAuth tokens (encrypted at rest via Fernet)
    tidal_access_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    tidal_refresh_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    tidal_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    tidal_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Beatport OAuth tokens (encrypted at rest via Fernet)
    beatport_access_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    beatport_refresh_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    beatport_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    beatport_oauth_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    beatport_oauth_code_verifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    beatport_subscription: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Help onboarding state (JSON array of page IDs)
    help_pages_seen: Mapped[str | None] = mapped_column(Text, nullable=True)

    events: Mapped[list["Event"]] = relationship("Event", back_populates="created_by")

    def get_help_pages_seen(self) -> list[str]:
        if not self.help_pages_seen:
            return []
        return json.loads(self.help_pages_seen)

    def mark_help_page_seen(self, page: str) -> None:
        pages = self.get_help_pages_seen()
        if page not in pages:
            pages.append(page)
            self.help_pages_seen = json.dumps(pages)
