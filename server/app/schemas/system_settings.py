from pydantic import BaseModel, Field


class SystemSettingsOut(BaseModel):
    registration_enabled: bool
    search_rate_limit_per_minute: int

    class Config:
        from_attributes = True


class SystemSettingsUpdate(BaseModel):
    registration_enabled: bool | None = None
    search_rate_limit_per_minute: int | None = Field(None, ge=1, le=100)
