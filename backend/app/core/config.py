from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[3] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    jwt_secret: str = Field(min_length=32)
    access_token_minutes: int = Field(default=60, ge=1, le=1440)
    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:3000"]
    upload_dir: str = "uploads"
    livekit_api_key: str
    livekit_api_secret: str = Field(min_length=32)
    livekit_internal_url: str = "http://localhost:7880"
    livekit_public_url: str = "ws://localhost:7880"


@lru_cache
def get_settings() -> Settings:
    return Settings()
