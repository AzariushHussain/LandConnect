import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import get_db
from app.main import app
from app.models import Base


@pytest.fixture
def auth_client():
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(test_engine)

    def session():
        with Session(test_engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            yield client, test_engine
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()
