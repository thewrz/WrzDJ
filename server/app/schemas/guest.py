"""Pydantic schemas for guest identity."""

from pydantic import BaseModel, Field


class IdentifyRequest(BaseModel):
    fingerprint_hash: str = Field(..., min_length=8, max_length=64)
    fingerprint_components: dict | None = None


class IdentifyResponse(BaseModel):
    guest_id: int
