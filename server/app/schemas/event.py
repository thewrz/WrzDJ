from datetime import datetime

from pydantic import BaseModel, Field


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
    join_url: str | None = None

    class Config:
        from_attributes = True
