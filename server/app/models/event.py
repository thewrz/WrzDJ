from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
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

    created_by: Mapped["User"] = relationship("User", back_populates="events")
    requests: Mapped[list["Request"]] = relationship("Request", back_populates="event")
