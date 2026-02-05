from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


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

    class Config:
        from_attributes = True
