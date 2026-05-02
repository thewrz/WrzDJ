"""Pydantic schemas for email verification."""

from pydantic import BaseModel, EmailStr, Field


class VerifyRequestSchema(BaseModel):
    email: EmailStr
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class VerifyConfirmSchema(BaseModel):
    email: EmailStr
    code: str


class VerifyRequestResponse(BaseModel):
    sent: bool


class VerifyConfirmResponse(BaseModel):
    verified: bool
    guest_id: int
    merged: bool
