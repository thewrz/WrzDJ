"""Schemas for the human-verification bootstrap endpoint."""

from pydantic import BaseModel, Field


class VerifyHumanRequest(BaseModel):
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class VerifyHumanResponse(BaseModel):
    verified: bool
    expires_in: int
