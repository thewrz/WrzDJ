"""Shared response models for endpoints that return simple JSON dicts."""

from pydantic import BaseModel


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
