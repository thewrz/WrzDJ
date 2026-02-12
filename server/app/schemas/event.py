from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_serializer


class EventStatus(str, Enum):
    """Status of an event based on expiry and archive state."""

    ACTIVE = "active"
    EXPIRED = "expired"
    ARCHIVED = "archived"


class EventCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    expires_hours: int = Field(default=6, ge=1, le=48)


class EventUpdate(BaseModel):
    expires_at: datetime | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)


class DisplaySettingsUpdate(BaseModel):
    """Request body for updating display settings."""

    now_playing_hidden: bool | None = None
    now_playing_auto_hide_minutes: int | None = Field(default=None, ge=1, le=1440)
    requests_open: bool | None = None


class DisplaySettingsResponse(BaseModel):
    """Response for display settings update."""

    status: str = "ok"
    now_playing_hidden: bool
    now_playing_auto_hide_minutes: int = 10
    requests_open: bool = True


class EventOut(BaseModel):
    id: int
    code: str
    name: str
    created_at: datetime
    expires_at: datetime
    is_active: bool
    archived_at: datetime | None = None
    status: EventStatus | None = None
    join_url: str | None = None
    request_count: int | None = None
    # Tidal sync settings
    tidal_sync_enabled: bool = False
    tidal_playlist_id: str | None = None
    # Beatport sync settings
    beatport_sync_enabled: bool = False
    # Banner
    banner_url: str | None = None
    banner_kiosk_url: str | None = None
    banner_colors: list[str] | None = None
    # Requests open/closed
    requests_open: bool = True

    class Config:
        from_attributes = True

    @field_serializer("created_at", "expires_at")
    def serialize_datetime(self, dt: datetime) -> str:
        return dt.isoformat() + "Z"

    @field_serializer("archived_at")
    def serialize_datetime_optional(self, dt: datetime | None) -> str | None:
        if dt is None:
            return None
        return dt.isoformat() + "Z"
