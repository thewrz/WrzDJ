from datetime import datetime

from pydantic import BaseModel, Field

from app.models.request import RequestSource, RequestStatus


class RequestCreate(BaseModel):
    artist: str = Field(..., min_length=1, max_length=255)
    title: str = Field(..., min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=500)
    source: RequestSource = RequestSource.MANUAL
    source_url: str | None = Field(default=None, max_length=500)
    artwork_url: str | None = Field(default=None, max_length=500)


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

    class Config:
        from_attributes = True
