"""Schemas for activity log."""

from pydantic import BaseModel, ConfigDict


class ActivityLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: str
    level: str
    source: str
    message: str
    event_code: str | None = None
