import uuid
from datetime import timedelta
from types import SimpleNamespace

import jwt
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.main import app
from app.models import Call, CallStatus, ChatOutbox, Role, User
from app.models.common import now
from app.schemas.call import CallCreate, CallEvent
from app.services import calls
from app.services.call_worker import maintain_calls
from tests.fakes import FakeRooms


@pytest.fixture
def people(auth_client):
    client, engine = auth_client
    from app.core.security import create_access_token

    ids, headers = {}, {}
    with Session(engine, expire_on_commit=False) as db:
        for name, role in zip(("a", "b", "c"), Role, strict=True):
            user = User(
                email=name + "@example.com", display_name=name, role=role, password_hash="unused"
            )
            db.add(user)
            db.flush()
            ids[name] = str(user.id)
            headers[name] = {"Authorization": "Bearer " + create_access_token(user.id)[0]}
        db.commit()
    rooms = FakeRooms(get_settings())
    app.state.calls.rooms = rooms
    return SimpleNamespace(client=client, engine=engine, ids=ids, headers=headers, rooms=rooms)


def start(p, kind="audio", client_id=None, actor="a", callee="b"):
    return p.client.post(
        "/calls",
        headers=p.headers[actor],
        json={
            "callee_id": p.ids[callee],
            "kind": kind,
            "client_id": client_id or str(uuid.uuid4()),
        },
    )


def act(p, call_id, action, actor="a"):
    return p.client.post(f"/calls/{call_id}/{action}", headers=p.headers[actor])


def accepted(p, kind="audio"):
    call_id = start(p, kind).json()["id"]
    assert act(p, call_id, "accept", "b").status_code == 200
    return call_id


def test_creation_retry_busy_and_private_history(people):
    p = people
    client_id = str(uuid.uuid4())
    first = start(p, client_id=client_id)
    assert first.status_code == 201 and first.headers["cache-control"] == "no-store"
    call_id = first.json()["id"]
    assert first.json()["status"] == "ringing"
    assert "@example.com" not in first.text and "password_hash" not in first.text
    assert start(p, client_id=client_id).json()["id"] == call_id
    assert start(p, "video", client_id).status_code == 409
    assert start(p, actor="c").status_code == 409
    assert start(p, actor="b", callee="a").status_code == 409
    items = p.client.get("/calls?direction=incoming&status=ringing", headers=p.headers["b"]).json()[
        "items"
    ]
    assert len(items) == 1 and items[0]["id"] == call_id
    assert p.client.get("/calls", headers=p.headers["c"]).json()["items"] == []
    assert p.client.get(f"/calls/{call_id}", headers=p.headers["c"]).status_code == 404
    assert act(p, call_id, "token", "c").status_code == 404
    assert p.client.get("/calls").status_code == 401
    assert start(p, actor="a", callee="a").status_code == 422


@pytest.mark.parametrize(
    "action,actor,status", [("reject", "b", "rejected"), ("cancel", "a", "cancelled")]
)
def test_ringing_terminal_actions_are_idempotent(people, action, actor, status):
    p = people
    call_id = start(p).json()["id"]
    assert act(p, call_id, action, actor).json()["status"] == status
    assert act(p, call_id, action, actor).json()["status"] == status
    assert act(p, call_id, "accept", "b").status_code == 409
    assert act(p, call_id, "token").status_code == 409
    assert start(p).status_code == 201


def test_transition_permissions_and_end(people):
    p = people
    call_id = start(p).json()["id"]
    assert act(p, call_id, "accept").status_code == 403
    assert act(p, call_id, "reject").status_code == 403
    assert act(p, call_id, "cancel", "b").status_code == 403
    assert act(p, call_id, "end").status_code == 409
    assert act(p, call_id, "accept", "b").json()["accepted_at"]
    assert act(p, call_id, "accept", "b").json()["status"] == "accepted"
    assert act(p, call_id, "reject", "b").status_code == 409
    assert act(p, call_id, "cancel").status_code == 409
    assert act(p, call_id, "end", "c").status_code == 404
    result = act(p, call_id, "end", "b")
    assert result.json()["status"] == "ended" and not result.json()["media_cleanup_pending"]
    assert uuid.UUID(call_id) not in p.rooms.live
    assert act(p, call_id, "end").json()["status"] == "ended"
    assert act(p, call_id, "token").status_code == 409


@pytest.mark.parametrize(
    "kind,sources", [("audio", ["microphone"]), ("video", ["microphone", "camera"])]
)
def test_tokens_are_scoped_to_participant_room_and_media_sources(people, kind, sources):
    p = people
    call_id = start(p, kind).json()["id"]
    assert act(p, call_id, "token").status_code == 409
    act(p, call_id, "accept", "b")
    for actor in ("a", "b"):
        result = act(p, call_id, "token", actor)
        assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
        body = result.json()
        claims = jwt.decode(body["token"], get_settings().livekit_api_secret, algorithms=["HS256"])
        assert claims["sub"] == p.ids[actor] and claims["video"]["room"] == "call-" + call_id
        assert claims["video"]["canPublishSources"] == sources
        assert claims["video"]["canPublishData"] is False
        assert claims["video"]["roomAdmin"] is False and claims["video"]["roomCreate"] is False
        assert claims["exp"] - claims["nbf"] == body["expires_in"] == 120


def test_timeout_is_persisted_and_not_accepted(people):
    p = people
    call_id = start(p).json()["id"]
    with Session(p.engine) as db:
        db.get(Call, uuid.UUID(call_id)).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert act(p, call_id, "accept", "b").status_code == 409
    assert p.client.get(f"/calls/{call_id}", headers=p.headers["a"]).json()["status"] == "missed"
    assert start(p).status_code == 201
    with Session(p.engine) as db:
        assert (
            len(
                [
                    row
                    for row in db.scalars(select(ChatOutbox)).all()
                    if row.event["type"] == "call.missed"
                ]
            )
            == 1
        )


def test_blocks_and_incoming_preferences(people):
    p = people
    p.client.patch("/users/me/privacy", headers=p.headers["b"], json={"allow_messages": False})
    call_id = start(p).json()["id"]
    p.client.put("/users/me/blocks/" + p.ids["a"], headers=p.headers["b"])
    assert p.client.get(f"/calls/{call_id}", headers=p.headers["a"]).json()["status"] == "cancelled"
    assert start(p).status_code == 403
    p.client.delete("/users/me/blocks/" + p.ids["a"], headers=p.headers["b"])
    p.client.patch("/users/me/privacy", headers=p.headers["b"], json={"allow_calls": False})
    assert start(p).status_code == 403
    assert start(p, actor="b", callee="a").status_code == 201


@pytest.mark.parametrize("setting", ["block", "preference"])
def test_privacy_changes_end_active_calls_and_cleanup(people, setting):
    p = people
    call_id = accepted(p)
    if setting == "block":
        p.client.put("/users/me/blocks/" + p.ids["a"], headers=p.headers["b"])
    else:
        p.client.patch("/users/me/privacy", headers=p.headers["b"], json={"allow_calls": False})
    assert act(p, call_id, "token").status_code == 409
    maintain_calls(sessionmaker(p.engine), p.rooms)
    result = p.client.get(f"/calls/{call_id}", headers=p.headers["a"]).json()
    assert result["status"] == "ended" and result["room_closed_at"]


def test_media_unavailability_does_not_accept_and_cleanup_retries(people, monkeypatch):
    from app.services.livekit import MediaUnavailable

    p = people
    call_id = start(p).json()["id"]
    create = p.rooms.create

    def fail(*args):
        raise MediaUnavailable

    monkeypatch.setattr(p.rooms, "create", fail)
    assert act(p, call_id, "accept", "b").status_code == 503
    assert p.client.get(f"/calls/{call_id}", headers=p.headers["a"]).json()["status"] == "ringing"
    monkeypatch.setattr(p.rooms, "create", create)
    act(p, call_id, "accept", "b")
    close = p.rooms.close
    monkeypatch.setattr(p.rooms, "close", fail)
    result = act(p, call_id, "end")
    assert result.status_code == 200 and result.json()["media_cleanup_pending"]
    assert uuid.UUID(call_id) in p.rooms.live
    monkeypatch.setattr(p.rooms, "close", close)
    maintain_calls(sessionmaker(p.engine), p.rooms)
    assert uuid.UUID(call_id) not in p.rooms.live
    assert not act(p, call_id, "end").json()["media_cleanup_pending"]


@pytest.mark.parametrize("room_state", ["healthy", "left", "missing"])
def test_reconciliation_ends_disconnected_calls_after_join_grace(people, room_state):
    p = people
    call_id = uuid.UUID(accepted(p))
    with Session(p.engine) as db:
        db.get(Call, call_id).accepted_at = now() - timedelta(seconds=46)
        db.commit()
    if room_state == "missing":
        p.rooms.live.clear()
    else:
        p.rooms.live[call_id].num_participants = 2 if room_state == "healthy" else 1
    maintain_calls(sessionmaker(p.engine), p.rooms)
    with Session(p.engine) as db:
        call = db.get(Call, call_id)
        assert call.status == (CallStatus.accepted if room_state == "healthy" else CallStatus.ended)


def test_worker_times_out_without_client_requests(people):
    p = people
    call_id = uuid.UUID(start(p).json()["id"])
    with Session(p.engine) as db:
        db.get(Call, call_id).expires_at = now() - timedelta(seconds=1)
        db.commit()
    maintain_calls(sessionmaker(p.engine), p.rooms)
    with Session(p.engine) as db:
        assert db.get(Call, call_id).status == CallStatus.missed


def test_failed_call_commit_does_not_save_call_or_notification(people, monkeypatch):
    p = people
    with Session(p.engine) as db:

        def fail():
            raise SQLAlchemyError("test failure")

        monkeypatch.setattr(db, "commit", fail)
        with pytest.raises(SQLAlchemyError):
            calls.create(
                db,
                uuid.UUID(p.ids["a"]),
                CallCreate(client_id=uuid.uuid4(), callee_id=p.ids["b"], kind="audio"),
                get_settings(),
            )
    with Session(p.engine) as db:
        assert db.scalar(select(func.count(Call.id))) == 0
        assert db.scalar(select(func.count(ChatOutbox.id))) == 0


def test_call_events_are_private_and_stale_ringing_is_not_forwarded(people):
    p = people
    call_id = start(p).json()["id"]
    event = CallEvent(
        event_id=uuid.uuid4(), type="call.incoming", call_id=call_id, actor_id=p.ids["a"]
    )
    with Session(p.engine) as db:
        assert calls.may_notify(db, uuid.UUID(p.ids["b"]), event)
        assert not calls.may_notify(db, uuid.UUID(p.ids["c"]), event)
    act(p, call_id, "accept", "b")
    with Session(p.engine) as db:
        assert not calls.may_notify(db, uuid.UUID(p.ids["b"]), event)
        for row in db.scalars(select(ChatOutbox)).all():
            assert "token" not in row.event and "body" not in row.event
