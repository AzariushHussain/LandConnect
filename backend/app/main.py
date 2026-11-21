from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import chat_error, request_validation_error
from app.api.middleware import RequestSizeLimitMiddleware
from app.api.router import router
from app.core.config import get_settings
from app.core.errors import ChatError
from app.db.session import SessionLocal, engine, get_db
from app.services.realtime import ChatHub


def create_app(session_factory=SessionLocal) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        hub = ChatHub(settings, session_factory)
        application.state.chat = hub
        await hub.start()
        try:
            yield
        finally:
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
    application.add_exception_handler(ChatError, chat_error)
    application.include_router(router)
    if session_factory is not SessionLocal:

        def session():
            with session_factory() as db:
                yield db

        application.dependency_overrides[get_db] = session
    return application


app = create_app()
