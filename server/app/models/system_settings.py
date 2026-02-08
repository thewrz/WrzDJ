from sqlalchemy import Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    registration_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    search_rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=30)
