"""Schemas for StageLinQ now-playing and play history."""

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer

# --- Bridge Inbound Payloads ---


class NowPlayingBridgePayload(BaseModel):
    """Payload from bridge when a new track starts playing."""

    event_code: str = Field(..., min_length=1, max_length=10)
    title: str = Field(..., min_length=1, max_length=255)
    artist: str = Field(..., min_length=1, max_length=255)
    album: str | None = Field(default=None, max_length=255)
    deck: str | None = Field(default=None, max_length=10)
    source: str | None = Field(default=None, max_length=20)


class BridgeStatusPayload(BaseModel):
    """Payload from bridge reporting connection status."""

    event_code: str = Field(..., min_length=1, max_length=10)
    connected: bool
    device_name: str | None = Field(default=None, max_length=100)
    # Optional enriched fields (backward compatible — bridge may omit all of these)
    circuit_breaker_state: str | None = Field(default=None, max_length=20)
    buffer_size: int | None = Field(default=None, ge=0)
    plugin_id: str | None = Field(default=None, max_length=50)
    deck_count: int | None = Field(default=None, ge=0)
    uptime_seconds: int | None = Field(default=None, ge=0)


# --- Public Outbound Responses ---


class NowPlayingResponse(BaseModel):
    """Response for current now-playing track."""

    title: str
    artist: str
    album: str | None = None
    album_art_url: str | None = None
    spotify_uri: str | None = None
    started_at: datetime
    source: str
    matched_request_id: int | None = None
    bridge_connected: bool = False

    class Config:
        from_attributes = True

    @field_serializer("started_at")
    def serialize_datetime(self, dt: datetime) -> str:
        return dt.isoformat() + "Z"


class PlayHistoryEntry(BaseModel):
    """Single entry in play history."""

    id: int
    title: str
    artist: str
    album: str | None = None
    album_art_url: str | None = None
    spotify_uri: str | None = None
    matched_request_id: int | None = None
    source: str
    started_at: datetime
    ended_at: datetime | None = None
    play_order: int

    class Config:
        from_attributes = True

    @field_serializer("started_at", "ended_at")
    def serialize_datetime(self, dt: datetime | None) -> str | None:
        if dt is None:
            return None
        return dt.isoformat() + "Z"


class PlayHistoryResponse(BaseModel):
    """Paginated response for play history."""

    items: list[PlayHistoryEntry]
    total: int
