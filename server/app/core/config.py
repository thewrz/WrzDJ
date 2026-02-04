import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Look for .env in project root (parent of server/)
_env_file = Path(__file__).resolve().parent.parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file, extra="ignore")

    # Environment
    env: Literal["development", "production"] = "development"

    # Server
    port: int = 8000  # PaaS platforms set PORT env var

    # Database - supports postgres://, postgresql://, or postgresql+psycopg://
    database_url: str = "postgresql+psycopg://wrzdj:wrzdj@localhost:5432/wrzdj"

    @property
    def database_url_sync(self) -> str:
        """Return database URL with psycopg driver for SQLAlchemy."""
        url = self.database_url
        # Convert postgres:// or postgresql:// to postgresql+psycopg://
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and "+psycopg" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Spotify API
    spotify_client_id: str = ""
    spotify_client_secret: str = ""

    # CORS - comma-separated origins or "*" for all (dev only)
    # Production: https://app.wrzdj.com
    cors_origins: str = "*"

    # Public URL for QR codes/links (e.g., https://app.wrzdj.com)
    public_url: str = ""

    # Rate limiting (disabled by default in dev, enable in prod)
    rate_limit_enabled: bool | None = None  # None = auto (disabled in dev, enabled in prod)
    login_rate_limit_per_minute: int = 5
    search_rate_limit_per_minute: int = 30
    request_rate_limit_per_minute: int = 10

    # Login lockout (disabled by default in dev, enable in prod)
    lockout_enabled: bool | None = None  # None = auto (disabled in dev, enabled in prod)

    @property
    def is_rate_limit_enabled(self) -> bool:
        """Check if rate limiting is enabled (auto-detect based on env if not set)."""
        if self.rate_limit_enabled is not None:
            return self.rate_limit_enabled
        return self.is_production

    @property
    def is_lockout_enabled(self) -> bool:
        """Check if lockout is enabled (auto-detect based on env if not set)."""
        if self.lockout_enabled is not None:
            return self.lockout_enabled
        return self.is_production

    # Cache durations (1 hour for Spotify since popularity changes)
    search_cache_hours: int = 1

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def validate_settings(settings: Settings) -> None:
    """Validate required settings and print helpful error messages."""
    errors = []

    if settings.is_production:
        if settings.jwt_secret == "change-me-in-production":
            errors.append("JWT_SECRET must be set to a secure value in production")
        if settings.cors_origins == "*":
            errors.append("CORS_ORIGINS should not be '*' in production - set to your frontend domain (e.g., https://app.wrzdj.com)")

    if not settings.spotify_client_id or not settings.spotify_client_secret:
        # Warning only, not fatal
        print("WARNING: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not set - song search will not work", file=sys.stderr)

    if errors:
        print("Configuration errors:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    validate_settings(settings)
    return settings
