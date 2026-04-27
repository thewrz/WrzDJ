"""Pydantic schemas for email verification."""

from pydantic import BaseModel, EmailStr


class VerifyRequestSchema(BaseModel):
    email: EmailStr


class VerifyConfirmSchema(BaseModel):
    email: EmailStr
    code: str


class VerifyRequestResponse(BaseModel):
    sent: bool


class VerifyConfirmResponse(BaseModel):
    verified: bool
    guest_id: int
    merged: bool
