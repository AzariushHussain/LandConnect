from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import get_db
from app.main import app


@pytest.fixture
def client():
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    with test_engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0004_meetings')"))

    def session():
        with Session(test_engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as test_client:
            yield test_client, test_engine
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_liveness_does_not_need_a_database(client):
    def unavailable_session():
        raise AssertionError("Liveness must not request a database session")

    app.dependency_overrides[get_db] = unavailable_session
    response = client[0].get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_with_current_schema(client):
    response = client[0].get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "database": "ok",
        "migrations": "current",
        "redis": "ok",
    }


@pytest.mark.parametrize("old_revision", [None, "old_revision"])
def test_readiness_refuses_missing_or_outdated_migrations(client, old_revision):
    with client[1].begin() as connection:
        if old_revision is None:
            connection.execute(text("DROP TABLE alembic_version"))
        else:
            connection.execute(
                text("UPDATE alembic_version SET version_num = :rev"), {"rev": old_revision}
            )
    response = client[0].get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database migrations are pending"}


def test_readiness_hides_database_error_details(client):
    db = MagicMock(spec=Session)
    db.execute.side_effect = SQLAlchemyError("connection failed with a private password")
    app.dependency_overrides[get_db] = lambda: db
    response = client[0].get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


def test_readiness_requires_the_realtime_subscriber(client):
    app.state.chat.ready = False
    response = client[0].get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"detail": "Realtime broker unavailable"}


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("http://localhost:8081", True),
        ("https://untrusted.example", False),
    ],
)
def test_cors_preflight(client, origin, allowed):
    response = client[0].options(
        "/health/ready",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert response.status_code == (200 if allowed else 400)
    assert response.headers.get("access-control-allow-origin") == (origin if allowed else None)


def test_api_documentation_is_available(client):
    assert client[0].get("/docs").status_code == 200
    schema = client[0].get("/openapi.json").json()
    assert {"/health/live", "/health/ready"} <= schema["paths"].keys()
