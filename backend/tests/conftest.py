import os

import pytest

from app.core.config import get_settings

# Unit tests must never connect to the developer's database from .env.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = (
    "unit-test-secret-with-at-least-64-characters-for-algorithm-rejection-tests"
)
os.environ["LIVEKIT_API_KEY"] = "test-key"
os.environ["LIVEKIT_API_SECRET"] = "unit-test-media-secret-with-at-least-32-characters"
os.environ["CORS_ORIGINS"] = '["http://localhost:8081"]'
get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolate_realtime(request, monkeypatch):
    from app.services.call_worker import CallWorker

    async def no_calls(worker):
        pass

    if not request.node.get_closest_marker("calling"):
        monkeypatch.setattr(CallWorker, "start", no_calls)
    if request.node.get_closest_marker("realtime"):
        return
    from app.services.realtime import ChatHub

    async def start(hub):
        hub.ready = True

    monkeypatch.setattr(ChatHub, "start", start)
