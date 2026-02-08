from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Tidal OAuth tokens (encrypted at rest in production)
    tidal_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    tidal_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    tidal_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    tidal_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    events: Mapped[list["Event"]] = relationship("Event", back_populates="created_by")
