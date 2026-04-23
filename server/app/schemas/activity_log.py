"""Schemas for activity log."""

from app.schemas.common import BaseSchema


class ActivityLogEntry(BaseSchema):
    id: int
    created_at: str
    level: str
    source: str
    message: str
    event_code: str | None = None
