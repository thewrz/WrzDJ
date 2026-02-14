from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    registration_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    search_rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=30)

    # Integration toggles (admin can disable broken services at runtime)
    spotify_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    tidal_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    beatport_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    bridge_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # LLM / AI settings
    llm_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    llm_model: Mapped[str] = mapped_column(String(100), default="claude-haiku-4-5-20251001")
    llm_rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=3)
