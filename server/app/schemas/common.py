"""Shared response models + base types used across the schema package."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer


class BaseSchema(BaseModel):
    """Base for response schemas that hydrate from SQLAlchemy model attributes."""

    model_config = ConfigDict(from_attributes=True)


# ISO8601 + "Z" suffix for naive-UTC datetimes. Use as a field type to get the
# serializer automatically without repeating @field_serializer in every schema.
IsoDatetime = Annotated[
    datetime,
    PlainSerializer(lambda dt: dt.isoformat() + "Z", return_type=str),
]

OptionalIsoDatetime = Annotated[
    datetime | None,
    PlainSerializer(
        lambda dt: dt.isoformat() + "Z" if dt is not None else None,
        return_type=str | None,
    ),
]


class StatusResponse(BaseModel):
    status: str


class StatusMessageResponse(BaseModel):
    status: str
    message: str


class BridgeApiKeyResponse(BaseModel):
    bridge_api_key: str


class AcceptAllResponse(BaseModel):
    status: str
    accepted_count: int


class BulkActionResponse(BaseModel):
    status: str
    count: int


class TidalAuthStartResponse(BaseModel):
    verification_url: str | None
    user_code: str
    message: str


class TidalAuthCheckResponse(BaseModel):
    complete: bool
    pending: bool | None = None
    verification_url: str | None = None
    user_code: str | None = None
    user_id: str | None = None
    error: str | None = None


class CacheClearResponse(BaseModel):
    message: str
