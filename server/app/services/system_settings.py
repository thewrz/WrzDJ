from sqlalchemy.orm import Session

from app.models.system_settings import SystemSettings


def get_system_settings(db: Session) -> SystemSettings:
    """Get the singleton system settings row, creating with defaults if missing."""
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(id=1, registration_enabled=True, search_rate_limit_per_minute=30)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def update_system_settings(
    db: Session,
    registration_enabled: bool | None = None,
    search_rate_limit_per_minute: int | None = None,
) -> SystemSettings:
    """Update system settings fields."""
    settings = get_system_settings(db)
    if registration_enabled is not None:
        settings.registration_enabled = registration_enabled
    if search_rate_limit_per_minute is not None:
        settings.search_rate_limit_per_minute = search_rate_limit_per_minute
    db.commit()
    db.refresh(settings)
    return settings
