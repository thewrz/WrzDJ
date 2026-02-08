from datetime import datetime

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.core.validation import normalize_single_line, normalize_text
from app.models.request import RequestSource, RequestStatus, TidalSyncStatus

DANGEROUS_URL_SCHEMES = {"javascript", "data", "vbscript"}


class RequestCreate(BaseModel):
    artist: str = Field(..., min_length=1, max_length=255)
    title: str = Field(..., min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=500)
    source: RequestSource = RequestSource.MANUAL
    source_url: str | None = Field(default=None, max_length=500)
    artwork_url: str | None = Field(default=None, max_length=500)

    @field_validator("artist", "title")
    @classmethod
    def normalize_single_line_fields(cls, v: str) -> str:
        normalized = normalize_single_line(v)
        return normalized if normalized else v

    @field_validator("note")
    @classmethod
    def normalize_note(cls, v: str | None) -> str | None:
        return normalize_text(v)

    @field_validator("source_url", "artwork_url")
    @classmethod
    def reject_dangerous_schemes(cls, v: str | None) -> str | None:
        if v is None:
            return v
        scheme = v.split(":", 1)[0].lower().strip()
        if scheme in DANGEROUS_URL_SCHEMES:
            raise ValueError(f"URL scheme '{scheme}' is not allowed")
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
    # Tidal sync status
    tidal_track_id: str | None = None
    tidal_sync_status: TidalSyncStatus | None = None
    # Voting
    vote_count: int = 0

    class Config:
        from_attributes = True

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, dt: datetime) -> str:
        return dt.isoformat() + "Z"
