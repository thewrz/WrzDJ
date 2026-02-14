"""Schemas for AI/LLM admin settings."""

from pydantic import BaseModel, Field


class AIModelInfo(BaseModel):
    id: str
    name: str


class AIModelsResponse(BaseModel):
    models: list[AIModelInfo]


class AISettingsOut(BaseModel):
    llm_enabled: bool
    llm_model: str
    llm_rate_limit_per_minute: int
    api_key_configured: bool
    api_key_masked: str


class AISettingsUpdate(BaseModel):
    llm_enabled: bool | None = None
    llm_model: str | None = None
    llm_rate_limit_per_minute: int | None = Field(None, ge=1, le=30)
