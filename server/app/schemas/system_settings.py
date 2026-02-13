from pydantic import BaseModel, Field


class SystemSettingsOut(BaseModel):
    registration_enabled: bool
    search_rate_limit_per_minute: int
    spotify_enabled: bool
    tidal_enabled: bool
    beatport_enabled: bool
    bridge_enabled: bool

    class Config:
        from_attributes = True


class SystemSettingsUpdate(BaseModel):
    registration_enabled: bool | None = None
    search_rate_limit_per_minute: int | None = Field(None, ge=1, le=100)
    spotify_enabled: bool | None = None
    tidal_enabled: bool | None = None
    beatport_enabled: bool | None = None
    bridge_enabled: bool | None = None
