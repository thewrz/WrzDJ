from pydantic import BaseModel, Field

from app.models.request import TidalSyncStatus


class TidalStatus(BaseModel):
    """Current Tidal account linking status."""

    linked: bool
    user_id: str | None = None
    expires_at: str | None = None


class TidalSearchResult(BaseModel):
    """Track result from Tidal search."""

    track_id: str
    title: str
    artist: str
    album: str | None = None
    duration_seconds: int | None = None
    cover_url: str | None = None
    tidal_url: str | None = None


class TidalSyncResult(BaseModel):
    """Result of syncing a request to Tidal playlist."""

    request_id: int
    status: TidalSyncStatus
    tidal_track_id: str | None = None
    error: str | None = None


class TidalEventSettings(BaseModel):
    """Tidal sync settings for an event."""

    tidal_sync_enabled: bool
    tidal_playlist_id: str | None = None


class TidalEventSettingsUpdate(BaseModel):
    """Update Tidal sync settings for an event."""

    tidal_sync_enabled: bool


class TidalManualLink(BaseModel):
    """Manual track linking request."""

    tidal_track_id: str = Field(..., min_length=1, max_length=100, pattern=r"^[0-9]+$")
