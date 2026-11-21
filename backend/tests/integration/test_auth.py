import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.main import app
from app.models.user import User

pytestmark = pytest.mark.postgres


def test_postgres_registration_login_and_current_user(migrated_database):
    engine, _ = migrated_database

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            payload = {
                "email": "Seller@EXAMPLE.COM",
                "password": "a long integration passphrase",
                "display_name": "Seller",
                "role": "seller",
            }
            registered = client.post("/auth/register", json=payload)
            assert registered.status_code == 201
            assert "password_hash" not in registered.json()
            assert (
                client.post(
                    "/auth/register", json=payload | {"email": "seller@example.com"}
                ).status_code
                == 409
            )
            login = client.post(
                "/auth/login", json={"email": "seller@example.com", "password": payload["password"]}
            )
            assert login.status_code == 200
            me = client.get(
                "/users/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"}
            )
            assert me.status_code == 200
            assert me.json() == registered.json()
            with Session(engine) as db:
                user = db.scalar(select(User).where(User.email == "seller@example.com"))
                assert user.password_hash.startswith("$argon2id$")
                assert user.password_hash != payload["password"]
    finally:
        app.dependency_overrides.clear()
