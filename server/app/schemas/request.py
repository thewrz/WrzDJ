from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.core.validation import normalize_single_line, normalize_text
from app.models.request import RequestSource, RequestStatus, TidalSyncStatus

ALLOWED_URL_SCHEMES = {"http", "https", "spotify"}


class RequestCreate(BaseModel):
    artist: str = Field(..., min_length=1, max_length=255)
    title: str = Field(..., min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=500)
    source: RequestSource = RequestSource.MANUAL
    source_url: str | None = Field(default=None, max_length=500)
    artwork_url: str | None = Field(default=None, max_length=500)
    raw_search_query: str | None = Field(default=None, max_length=200)
    # Track metadata from search sources
    genre: str | None = Field(default=None, max_length=100)
    bpm: float | None = Field(default=None, ge=1, le=999)
    musical_key: str | None = Field(default=None, max_length=20)

    @field_validator("artist", "title")
    @classmethod
    def normalize_single_line_fields(cls, v: str) -> str:
        normalized = normalize_single_line(v)
        return normalized if normalized else v

    @field_validator("note")
    @classmethod
    def normalize_note(cls, v: str | None) -> str | None:
        return normalize_text(v)

    @field_validator("raw_search_query")
    @classmethod
    def normalize_raw_search_query(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalized = normalize_single_line(v)
        return normalized if normalized else v

    @field_validator("source_url", "artwork_url")
    @classmethod
    def validate_url_scheme(cls, v: str | None) -> str | None:
        if v is None:
            return v
        scheme = urlparse(v).scheme.lower()
        if scheme not in ALLOWED_URL_SCHEMES:
            raise ValueError(f"URL scheme '{scheme or '(empty)'}' is not allowed")
        return v


class RequestUpdate(BaseModel):
    status: RequestStatus


class RequestOut(BaseModel):
    id: int
    event_id: int
    song_title: str
    artist: str
    source: str
    source_url: str | None
    artwork_url: str | None
    note: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    is_duplicate: bool = False
    # Track metadata
    genre: str | None = None
    bpm: float | None = None
    musical_key: str | None = None
    # Search intent
    raw_search_query: str | None = None
    # Tidal sync status
    tidal_track_id: str | None = None
    tidal_sync_status: TidalSyncStatus | None = None
    # Multi-service sync results (JSON array)
    sync_results_json: str | None = None
    # Voting
    vote_count: int = 0

    class Config:
        from_attributes = True

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, dt: datetime) -> str:
        return dt.isoformat() + "Z"
