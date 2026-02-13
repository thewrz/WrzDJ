"""Beatport API schemas."""

from pydantic import BaseModel, Field


class BeatportStatus(BaseModel):
    """Current Beatport account linking status."""

    linked: bool
    expires_at: str | None = None
    configured: bool = True
    subscription: str | None = None  # e.g., "bp_link", "bp_pro", None


class BeatportSearchResult(BaseModel):
    """Track result from Beatport search."""

    track_id: str
    title: str
    artist: str
    mix_name: str | None = None
    label: str | None = None
    genre: str | None = None
    bpm: int | None = None
    key: str | None = None
    duration_seconds: int | None = None
    cover_url: str | None = None
    beatport_url: str | None = None
    release_date: str | None = None


class BeatportEventSettings(BaseModel):
    """Beatport sync settings for an event."""

    beatport_sync_enabled: bool


class BeatportEventSettingsUpdate(BaseModel):
    """Update Beatport sync settings for an event."""

    beatport_sync_enabled: bool


class BeatportLogin(BaseModel):
    """Login request with Beatport credentials."""

    username: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)


class BeatportManualLink(BaseModel):
    """Manual Beatport track linking request."""

    beatport_track_id: str = Field(..., min_length=1, max_length=100, pattern=r"^[0-9]+$")
