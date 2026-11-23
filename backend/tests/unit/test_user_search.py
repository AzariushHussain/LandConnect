import uuid

import pytest
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import Block, Role, User


@pytest.fixture
def directory(auth_client):
    client, engine = auth_client
    with Session(engine, expire_on_commit=False) as db:
        actor = User(
            email="me@example.com",
            display_name="Shared Me",
            role=Role.buyer,
            password_hash="unused",
        )
        db.add(actor)
        db.commit()
        token, _ = create_access_token(actor.id)
    return client, engine, actor.id, {"Authorization": "Bearer " + token}


def add_person(engine, name, email, **options):
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            email=email, display_name=name, role=Role.seller, password_hash="unused", **options
        )
        db.add(user)
        db.commit()
        return user.id


def test_search_requires_auth_and_a_bounded_nonempty_query(directory):
    client, _, _, headers = directory
    assert client.get("/users/search", params={"q": "Alice"}).status_code == 401
    for params in ({}, {"q": " "}, {"q": "a"}, {"q": "x" * 255}, {"q": "Alice", "x": 1}):
        assert client.get("/users/search", params=params, headers=headers).status_code == 422


def test_search_matches_names_or_exact_email_without_returning_contacts(directory):
    client, engine, _, headers = directory
    target = add_person(engine, "Alicia Estates", "alicia@example.com")
    add_person(engine, "Lot%_ Team", "literal@example.com")
    for term in ("  LiCiA  ", "ALICIA@EXAMPLE.COM"):
        response = client.get("/users/search", params={"q": term}, headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json() == {
            "items": [{"id": str(target), "display_name": "Alicia Estates", "role": "seller"}],
            "has_more": False,
        }
    assert (
        client.get("/users/search", params={"q": "@example.com"}, headers=headers).json()["items"]
        == []
    )
    literal = client.get("/users/search", params={"q": "%_"}, headers=headers).json()
    assert [p["display_name"] for p in literal["items"]] == ["Lot%_ Team"]


def test_search_excludes_self_blocks_in_both_directions_and_disabled_messaging(directory):
    client, engine, actor, headers = directory
    visible = add_person(engine, "Shared Visible", "visible@example.com")
    blocked = add_person(engine, "Shared Blocked", "blocked@example.com")
    blocker = add_person(engine, "Shared Blocker", "blocker@example.com")
    add_person(engine, "Shared Private", "private@example.com", allow_messages=False)
    with Session(engine) as db:
        db.add_all(
            [
                Block(blocker_id=actor, blocked_id=blocked),
                Block(blocker_id=blocker, blocked_id=actor),
            ]
        )
        db.commit()
    result = client.get("/users/search", params={"q": "Shared"}, headers=headers).json()
    assert [p["id"] for p in result["items"]] == [str(visible)]
    with Session(engine) as db:
        db.get(User, visible).allow_messages = False
        db.commit()
    denied = client.post(
        "/conversations/direct", json={"recipient_id": str(visible)}, headers=headers
    )
    assert denied.status_code == 403


def test_search_selection_creates_then_reopens_the_same_direct_chat(directory):
    client, engine, _, headers = directory
    target = add_person(engine, "New Person", "new@example.com")
    result = client.get("/users/search", params={"q": "New Person"}, headers=headers).json()
    assert result["items"][0]["id"] == str(target)
    first = client.post(
        "/conversations/direct", json={"recipient_id": str(target)}, headers=headers
    )
    second = client.post(
        "/conversations/direct", json={"recipient_id": str(target)}, headers=headers
    )
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


def test_search_caps_results_and_reports_when_to_refine(directory):
    client, engine, _, headers = directory
    with Session(engine) as db:
        db.add_all(
            [
                User(
                    id=uuid.uuid4(),
                    email=f"directory{i}@example.com",
                    display_name=f"Directory {i:02}",
                    role=Role.buyer,
                    password_hash="unused",
                )
                for i in range(25)
            ]
        )
        db.commit()
    result = client.get("/users/search", params={"q": "Directory"}, headers=headers).json()
    assert result["has_more"] is True
    assert [p["display_name"] for p in result["items"]] == [f"Directory {i:02}" for i in range(20)]
