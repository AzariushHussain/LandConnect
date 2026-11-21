import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.security import (
    JWT_ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
    create_access_token,
    verify_password,
)
from app.db.session import get_db
from app.main import app
from app.models import Role, User

PASSWORD = "a long test passphrase"


def registration(role="buyer"):
    return {
        "email": "person@example.com",
        "password": PASSWORD,
        "display_name": "  Test Person  ",
        "role": role,
    }


def claims_for(user_id):
    issued = datetime.now(UTC)
    return {
        "sub": str(user_id),
        "iat": issued,
        "exp": issued + timedelta(minutes=5),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "token_use": "access",
    }


@pytest.mark.parametrize("role", ["buyer", "seller", "broker"])
def test_register_hashes_password_and_returns_only_safe_fields(auth_client, role):
    client, engine = auth_client
    payload = registration(role) | {"email": "Person@EXAMPLE.COM"}
    response = client.post("/auth/register", json=payload)
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["email"] == "person@example.com"
    assert body["display_name"] == "Test Person"
    assert body["role"] == role
    assert body["allow_messages"] and body["allow_calls"]
    assert not {"password", "password_hash"} & body.keys()
    assert PASSWORD not in response.text
    with Session(engine) as db:
        user = db.get(User, uuid.UUID(body["id"]))
        assert user.password_hash.startswith("$argon2id$")
        assert user.password_hash != PASSWORD
        assert verify_password(PASSWORD, user.password_hash)


def test_registration_defaults_to_buyer(auth_client):
    payload = registration()
    payload.pop("role")
    response = auth_client[0].post("/auth/register", json=payload)
    assert response.status_code == 201
    assert response.json()["role"] == "buyer"


def test_registration_rejects_duplicate_normalized_email(auth_client):
    client, _ = auth_client
    assert client.post("/auth/register", json=registration()).status_code == 201
    response = client.post("/auth/register", json=registration() | {"email": "PERSON@example.com"})
    assert response.status_code == 409
    assert response.json() == {"detail": "Email is already registered"}
    assert (
        client.post(
            "/auth/register", json=registration() | {"email": "another@example.com"}
        ).status_code
        == 201
    )


@pytest.mark.parametrize(
    "invalid",
    [
        {"email": "not-an-email"},
        {"role": "admin"},
        {"password": "too short"},
        {"password": "x" * 129},
        {"display_name": "   "},
        {"display_name": "x" * 81},
        {"id": "client-supplied"},
        {"password_hash": "client-supplied"},
        {"allow_calls": False},
        {"password": {"secret": "do-not-echo-me"}},
    ],
)
def test_registration_validates_input_without_echoing_secrets(auth_client, invalid):
    response = auth_client[0].post("/auth/register", json=registration() | invalid)
    assert response.status_code == 422
    assert PASSWORD not in response.text
    assert "do-not-echo-me" not in response.text
    assert all("input" not in error and "ctx" not in error for error in response.json()["detail"])


def test_login_and_current_user(auth_client):
    client, _ = auth_client
    created = client.post("/auth/register", json=registration()).json()
    login = client.post("/auth/login", json={"email": "PERSON@example.com", "password": PASSWORD})
    assert login.status_code == 200
    assert login.headers["cache-control"] == "no-store"
    body = login.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == get_settings().access_token_minutes * 60
    claims = jwt.decode(
        body["access_token"],
        get_settings().jwt_secret,
        algorithms=[JWT_ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
    )
    assert claims["sub"] == created["id"]
    assert claims["token_use"] == "access"
    assert claims["exp"] - claims["iat"] == body["expires_in"]
    assert not {"password", "password_hash", "email", "role"} & claims.keys()
    me = client.get("/users/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json() == created
    assert me.headers["cache-control"] == "no-store"
    assert PASSWORD not in me.text


@pytest.mark.parametrize("email", ["person@example.com", "missing@example.com"])
def test_wrong_password_and_missing_account_return_same_error(auth_client, email):
    client, _ = auth_client
    client.post("/auth/register", json=registration())
    response = client.post("/auth/login", json={"email": email, "password": "incorrect password"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {"detail": "Incorrect email or password"}


def test_password_whitespace_is_preserved(auth_client):
    client, _ = auth_client
    password = "  " + PASSWORD + "  "
    assert (
        client.post("/auth/register", json=registration() | {"password": password}).status_code
        == 201
    )
    assert (
        client.post(
            "/auth/login", json={"email": "person@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/login", json={"email": "person@example.com", "password": password}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "authorization", [None, "Basic dXNlcjpwYXNz", "Bearer", "Bearer not-a-jwt"]
)
def test_current_user_requires_a_bearer_token(auth_client, authorization):
    headers = {"Authorization": authorization} if authorization else {}
    response = auth_client[0].get("/users/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "invalid",
    [
        "expired",
        "signature",
        "unsigned",
        "algorithm",
        "issuer",
        "audience",
        "purpose",
        "subject",
        "future_iat",
        "missing_sub",
        "missing_exp",
        "missing_iat",
        "missing_iss",
        "missing_aud",
        "missing_token_use",
    ],
)
def test_invalid_tokens_cannot_access_current_user(auth_client, invalid):
    client, _ = auth_client
    created = client.post("/auth/register", json=registration()).json()
    claims = claims_for(created["id"])
    algorithm, key = JWT_ALGORITHM, get_settings().jwt_secret
    if invalid == "expired":
        claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    elif invalid == "signature":
        key = "incorrect-signing-secret-with-at-least-32-characters"
    elif invalid == "unsigned":
        algorithm, key = "none", ""
    elif invalid == "algorithm":
        algorithm = "HS512"
    elif invalid == "issuer":
        claims["iss"] = "another-issuer"
    elif invalid == "audience":
        claims["aud"] = "another-api"
    elif invalid == "purpose":
        claims["token_use"] = "refresh"
    elif invalid == "subject":
        claims["sub"] = "not-a-uuid"
    elif invalid == "future_iat":
        claims["iat"] = datetime.now(UTC) + timedelta(hours=1)
    else:
        claims.pop(invalid.removeprefix("missing_"))
    token = jwt.encode(claims, key, algorithm=algorithm)
    response = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Could not validate credentials"}


def test_deleted_user_token_is_rejected(auth_client):
    client, engine = auth_client
    created = client.post("/auth/register", json=registration()).json()
    token, _ = create_access_token(uuid.UUID(created["id"]))
    with Session(engine) as db:
        db.delete(db.get(User, uuid.UUID(created["id"])))
        db.commit()
    assert client.get("/users/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


@pytest.mark.parametrize("bad_hash", ["not-a-password-hash", "$argon2id$v=19$broken"])
def test_corrupt_stored_password_does_not_authenticate(auth_client, bad_hash):
    client, engine = auth_client
    created = client.post("/auth/register", json=registration()).json()
    with Session(engine) as db:
        user = db.get(User, uuid.UUID(created["id"]))
        user.password_hash = bad_hash
        db.commit()
    assert (
        client.post(
            "/auth/login", json={"email": "person@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )


def guarded_client():
    protected_app = FastAPI()
    protected_app.dependency_overrides[get_db] = app.dependency_overrides[get_db]

    @protected_app.get("/restricted")
    def restricted(user: Annotated[User, Depends(require_roles(Role.seller, Role.broker))]):
        return {"id": str(user.id)}

    return TestClient(protected_app)


@pytest.mark.parametrize("role,expected", [("buyer", 403), ("seller", 200), ("broker", 200)])
def test_role_guard_allows_only_sellers_and_brokers(auth_client, role, expected):
    created = auth_client[0].post("/auth/register", json=registration(role)).json()
    token, _ = create_access_token(uuid.UUID(created["id"]))
    with guarded_client() as client:
        response = client.get("/restricted", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == expected


def test_role_guard_reads_current_database_role_and_ignores_token_role(auth_client):
    client, engine = auth_client
    created = client.post("/auth/register", json=registration()).json()
    claims = claims_for(created["id"]) | {"role": "broker"}
    token = jwt.encode(claims, get_settings().jwt_secret, algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    with guarded_client() as protected:
        assert protected.get("/restricted", headers=headers).status_code == 403
        with Session(engine) as db:
            user = db.scalar(select(User).where(User.email == "person@example.com"))
            user.role = Role.seller
            db.commit()
        assert protected.get("/restricted", headers=headers).status_code == 200


def test_unknown_or_empty_hash_never_authenticates_dummy_password():
    assert not verify_password("landconnect-dummy-password", None)
    assert not verify_password("landconnect-dummy-password", "")
