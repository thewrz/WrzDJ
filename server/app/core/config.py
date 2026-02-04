from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://wrzdj:wrzdj@localhost:5432/wrzdj"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    musicbrainz_user_agent: str = "WrzDJ/0.1 (admin@wrzonance.com)"
    cors_origins: str = "http://localhost:3000"

    # Rate limiting
    search_rate_limit_per_minute: int = 30
    request_rate_limit_per_minute: int = 10

    # Cache durations
    search_cache_hours: int = 24

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
