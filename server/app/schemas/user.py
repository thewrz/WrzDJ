import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserOut(BaseModel):
    id: int
    username: str
    is_active: bool
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class AdminUserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    role: str = "dj"


class AdminUserUpdate(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)


class AdminUserOut(BaseModel):
    id: int
    username: str
    is_active: bool
    role: str
    created_at: datetime
    event_count: int = 0

    class Config:
        from_attributes = True


class AdminEventOut(BaseModel):
    id: int
    code: str
    name: str
    owner_username: str
    owner_id: int
    created_at: datetime
    expires_at: datetime
    is_active: bool
    request_count: int = 0

    class Config:
        from_attributes = True


class SystemStats(BaseModel):
    total_users: int
    active_users: int
    pending_users: int
    total_events: int
    active_events: int
    total_requests: int


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    limit: int


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8)
    confirm_password: str
    turnstile_token: str = Field("", max_length=2048)

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            msg = "Username must contain only letters, numbers, and underscores"
            raise ValueError(msg)
        return v

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v: str, info) -> str:
        if "password" in info.data and v != info.data["password"]:
            msg = "Passwords do not match"
            raise ValueError(msg)
        return v


class PublicSettings(BaseModel):
    registration_enabled: bool
    turnstile_site_key: str
