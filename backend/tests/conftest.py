import os

from app.core.config import get_settings

# Unit tests must never connect to the developer's database from .env.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "unit-test-secret-with-at-least-32-characters"
os.environ["LIVEKIT_API_KEY"] = "test-key"
os.environ["LIVEKIT_API_SECRET"] = "unit-test-media-secret-with-at-least-32-characters"
os.environ["CORS_ORIGINS"] = '["http://localhost:8081"]'
get_settings.cache_clear()
