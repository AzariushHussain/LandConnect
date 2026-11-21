import queue
import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import create_app
from app.models import Role, User

pytestmark = [pytest.mark.postgres, pytest.mark.realtime]


def receive_event(socket, event_type, message_id=None):
    result = queue.Queue()

    def read():
        try:
            while True:
                event = socket.receive_json()
                if event["type"] == "ping":
                    socket.send_json({"type": "pong"})
                if event["type"] == event_type and (
                    message_id is None or event.get("message_id") == message_id
                ):
                    result.put(event)
                    return
        except BaseException as error:
            result.put(error)

    threading.Thread(target=read, daemon=True).start()
    outcome = result.get(timeout=8)
    if isinstance(outcome, BaseException):
        raise outcome
    return outcome


@pytest.fixture
def servers(migrated_database, monkeypatch):
    import os

    redis_url = os.getenv("TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("Set TEST_REDIS_URL to verify real cross-instance Pub/Sub")
    publisher = Redis.from_url(
        redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
    )
    assert publisher.ping()
    monkeypatch.setenv("REDIS_URL", redis_url)
    monkeypatch.setenv("CHAT_CHANNEL_PREFIX", "test:chat:" + uuid.uuid4().hex)
    get_settings.cache_clear()
    engine, _ = migrated_database
    factory = sessionmaker(engine, expire_on_commit=False)
    ids, tokens, headers = {}, {}, {}
    with factory() as db:
        for name in ("a", "b", "c"):
            user = User(
                email=name + "@example.com",
                display_name=name,
                role=Role.buyer,
                password_hash="not-used-in-chat-tests",
            )
            db.add(user)
            db.flush()
            ids[name] = str(user.id)
            tokens[name], _ = create_access_token(user.id)
            headers[name] = {"Authorization": "Bearer " + tokens[name]}
        db.commit()
    app_a, app_b = create_app(factory), create_app(factory)
    try:
        with TestClient(app_a) as a, TestClient(app_b) as b:
            assert a.get("/health/ready").status_code == 200
            assert b.get("/health/ready").status_code == 200
            assert app_a.state.chat is not app_b.state.chat
            yield a, b, ids, tokens, headers, publisher, app_b
    finally:
        publisher.close()
        get_settings.cache_clear()


def test_real_redis_fans_out_between_instances_and_member_removal_takes_effect(servers):
    a, b, ids, tokens, headers, _, _ = servers
    created = a.post(
        "/conversations/groups",
        headers=headers["a"],
        json={"name": "Real group", "member_ids": [ids["b"], ids["c"]]},
    )
    assert created.status_code == 201
    conversation = created.json()["id"]
    path = f"/conversations/{conversation}"
    with b.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": tokens["b"]})
        assert socket.receive_json()["type"] == "ready"
        message = a.post(
            path + "/messages",
            headers=headers["a"],
            json={"client_id": str(uuid.uuid4()), "body": "private group text"},
        )
        assert message.status_code == 201
        event = receive_event(socket, "message.created", message.json()["id"])
        assert event["conversation_id"] == conversation
        assert "body" not in event and "private group text" not in str(event)
        assert (
            b.get(path + "/messages", headers=headers["b"]).json()["items"][0]["body"]
            == "private group text"
        )
        assert a.delete(path + "/members/" + ids["b"], headers=headers["a"]).status_code == 204
        removed = receive_event(socket, "membership.removed")
        assert removed["target_user_id"] == ids["b"]
        assert b.get(path + "/messages", headers=headers["b"]).status_code == 404
        assert (
            b.post(
                path + "/messages",
                headers=headers["b"],
                json={"client_id": str(uuid.uuid4()), "body": "bypass"},
            ).status_code
            == 404
        )


def test_subscriber_disconnect_reconnects_and_history_recovers(servers):
    a, b, ids, tokens, headers, publisher, app_b = servers
    conversation = a.post(
        "/conversations/direct", headers=headers["a"], json={"recipient_id": ids["b"]}
    ).json()["id"]
    path = f"/conversations/{conversation}/messages"
    with b.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": tokens["b"]})
        assert socket.receive_json()["type"] == "ready"
        target = [
            client
            for client in publisher.client_list()
            if client["name"] == app_b.state.chat.instance_id and "P" in client["flags"]
        ]
        assert len(target) == 1
        publisher.client_kill_filter(_id=target[0]["id"])
        with pytest.raises(WebSocketDisconnect) as error:
            receive_event(socket, "never")
        assert error.value.code == 1013
    stored = a.post(
        path,
        headers=headers["a"],
        json={"client_id": str(uuid.uuid4()), "body": "recover after disconnect"},
    )
    assert stored.status_code == 201
    deadline = time.monotonic() + 5
    while not app_b.state.chat.ready and time.monotonic() < deadline:
        time.sleep(0.05)
    with b.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": tokens["b"]})
        assert socket.receive_json()["type"] == "ready"
        recovered = b.get(path + "?after_id=0", headers=headers["b"]).json()
        assert recovered["items"][0]["id"] == stored.json()["id"]
