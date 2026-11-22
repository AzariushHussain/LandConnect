from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import request_validation_error, service_error
from app.api.middleware import RequestSizeLimitMiddleware
from app.api.router import router
from app.core.config import get_settings
from app.core.errors import ServiceError
from app.db.session import SessionLocal, engine, get_db
from app.services.call_worker import CallWorker
from app.services.livekit import LiveKitRooms
from app.services.realtime import ChatHub


def create_app(session_factory=SessionLocal) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        hub = ChatHub(settings, session_factory)
        application.state.chat = hub
        calls = CallWorker(session_factory, LiveKitRooms(settings))
        application.state.calls = calls
        await hub.start()
        await calls.start()
        try:
            yield
        finally:
            await calls.close()
            await hub.close()
            engine.dispose()

    application = FastAPI(
        title="LandConnect API",
        description="Land marketplace with authentication, listings, private and group messaging.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(RequestSizeLimitMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    application.add_exception_handler(RequestValidationError, request_validation_error)
    application.add_exception_handler(ServiceError, service_error)
    application.include_router(router)
    if session_factory is not SessionLocal:

        def session():
            with session_factory() as db:
                yield db

        application.dependency_overrides[get_db] = session
    return application


app = create_app()
