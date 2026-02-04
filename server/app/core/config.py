from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Look for .env in project root (parent of server/)
_env_file = Path(__file__).resolve().parent.parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file, extra="ignore")

    database_url: str = "postgresql+psycopg://wrzdj:wrzdj@localhost:5432/wrzdj"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    spotify_client_id: str = ""
    spotify_client_secret: str = ""
    cors_origins: str = "*"  # Allow all origins for local dev; restrict in production via .env
    public_url: str = ""  # Public URL for QR codes/links (e.g., https://dj.example.com)

    # Rate limiting
    search_rate_limit_per_minute: int = 30
    request_rate_limit_per_minute: int = 10

    # Cache durations (1 hour for Spotify since popularity changes)
    search_cache_hours: int = 1


@lru_cache
def get_settings() -> Settings:
    return Settings()
