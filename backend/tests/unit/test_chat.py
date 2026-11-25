import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, create_access_token
from app.main import app
from app.models import ChatOutbox, ConversationMember, Message, Role, User
from app.schemas.chat import ChatEvent, MessageCreate
from app.services import chat
from app.services.chat_outbox import flush_outbox
from app.services.realtime import ChatHub


@pytest.fixture
def people(auth_client):
    client, engine = auth_client
    headers, ids, tokens = {}, {}, {}
    with Session(engine, expire_on_commit=False) as db:
        for name in ("a", "b", "c", "d"):
            user = User(
                email=name + "@example.com",
                display_name=name,
                role=Role.buyer,
                password_hash="not-used-in-chat-tests",
            )
            db.add(user)
            db.flush()
            token, _ = create_access_token(user.id)
            headers[name] = {"Authorization": "Bearer " + token}
            ids[name], tokens[name] = str(user.id), token
        db.commit()
    app.state.chat.session_factory = lambda: Session(engine)
    return SimpleNamespace(client=client, engine=engine, headers=headers, ids=ids, tokens=tokens)


def direct(people):
    response = people.client.post(
        "/conversations/direct", headers=people.headers["a"], json={"recipient_id": people.ids["b"]}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_block_status_is_private_directional_and_tracks_confirmed_changes(people):
    path = "/users/me/blocks/" + people.ids["b"]
    assert people.client.get(path).status_code == 401
    response = people.client.get(path, headers=people.headers["a"])
    assert response.json() == {"user_id": people.ids["b"], "blocked": False}
    assert response.headers["cache-control"] == "no-store"
    assert people.client.put(path, headers=people.headers["a"]).status_code == 204
    assert people.client.get(path, headers=people.headers["a"]).json()["blocked"] is True
    # Neither another user's block list nor the reverse block direction is disclosed.
    assert people.client.get(path, headers=people.headers["c"]).json()["blocked"] is False
    reverse = "/users/me/blocks/" + people.ids["a"]
    assert people.client.get(reverse, headers=people.headers["b"]).json()["blocked"] is False
    assert people.client.delete(path, headers=people.headers["a"]).status_code == 204
    assert people.client.get(path, headers=people.headers["a"]).json()["blocked"] is False
    assert people.client.get(reverse, headers=people.headers["a"]).status_code == 422
    assert (
        people.client.get("/users/me/blocks/not-a-uuid", headers=people.headers["a"]).status_code
        == 422
    )
    assert (
        people.client.get(
            "/users/me/blocks/" + str(uuid.uuid4()), headers=people.headers["a"]
        ).status_code
        == 404
    )


def group(people):
    response = people.client.post(
        "/conversations/groups",
        headers=people.headers["a"],
        json={"name": "  Land group  ", "member_ids": [people.ids["b"], people.ids["c"]]},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def send(people, conversation, actor="a", body="Hello", client_id=None):
    return people.client.post(
        f"/conversations/{conversation}/messages",
        headers=people.headers[actor],
        json={"body": body, "client_id": client_id or str(uuid.uuid4())},
    )


def test_direct_creation_is_canonical_and_private(people):
    conversation = direct(people)
    repeated = people.client.post(
        "/conversations/direct", headers=people.headers["b"], json={"recipient_id": people.ids["a"]}
    )
    assert repeated.status_code == 200 and repeated.json()["id"] == conversation
    assert repeated.json()["kind"] == "direct" and len(repeated.json()["members"]) == 2
    assert "@example.com" not in repeated.text and "password_hash" not in repeated.text
    assert (
        people.client.get("/conversations", headers=people.headers["a"]).json()["items"][0]["id"]
        == conversation
    )
    assert people.client.get("/conversations", headers=people.headers["c"]).json()["items"] == []
    assert (
        people.client.get(f"/conversations/{conversation}", headers=people.headers["c"]).status_code
        == 404
    )
    assert people.client.get("/conversations").status_code == 401
    assert (
        people.client.post(
            "/conversations/direct",
            headers=people.headers["a"],
            json={"recipient_id": people.ids["a"]},
        ).status_code
        == 422
    )
    assert (
        people.client.post(
            "/conversations/direct",
            headers=people.headers["a"],
            json={"recipient_id": str(uuid.uuid4())},
        ).status_code
        == 404
    )


def test_message_retry_is_idempotent_and_history_is_ordered(people):
    conversation = direct(people)
    client_id = str(uuid.uuid4())
    first = send(people, conversation, body="  original text  ", client_id=client_id)
    assert first.status_code == 201 and first.json()["body"] == "  original text  "
    repeated = send(people, conversation, body="  original text  ", client_id=client_id)
    assert repeated.status_code == 200 and repeated.json()["id"] == first.json()["id"]
    assert send(people, conversation, body="different", client_id=client_id).status_code == 409
    assert send(people, conversation, actor="b", client_id=client_id).status_code == 201
    for text in ("third", "fourth", "fifth"):
        assert send(people, conversation, body=text).status_code == 201
    path = f"/conversations/{conversation}/messages"
    latest = people.client.get(path, headers=people.headers["a"], params={"limit": 2}).json()
    assert [item["body"] for item in latest["items"]] == ["fourth", "fifth"]
    assert latest["has_more"] and latest["next_before_id"] == latest["items"][0]["id"]
    older = people.client.get(
        path,
        headers=people.headers["a"],
        params={"limit": 2, "before_id": latest["next_before_id"]},
    ).json()
    assert [item["body"] for item in older["items"]] == ["Hello", "third"]
    catchup = people.client.get(
        path, headers=people.headers["b"], params={"after_id": 0, "limit": 3}
    ).json()
    assert len(catchup["items"]) == 3 and catchup["has_more"]
    assert [item["id"] for item in catchup["items"]] == sorted(
        item["id"] for item in catchup["items"]
    )
    assert "@example.com" not in str(catchup)
    assert people.client.get(path, headers=people.headers["c"]).status_code == 404
    assert send(people, conversation, actor="c").status_code == 404


@pytest.mark.parametrize("body", ["", "   ", "x" * 4001])
def test_invalid_messages_are_rejected(people, body):
    assert send(people, direct(people), body=body).status_code == 422


@pytest.mark.parametrize(
    "params", [{"after_id": 0, "before_id": 5}, {"limit": 101}, {"after_id": -1}, {"x": 1}]
)
def test_invalid_history_queries_are_rejected(people, params):
    conversation = direct(people)
    assert (
        people.client.get(
            f"/conversations/{conversation}/messages", headers=people.headers["a"], params=params
        ).status_code
        == 422
    )


def test_group_permissions_membership_and_ownership(people):
    conversation = group(people)
    path = f"/conversations/{conversation}"
    assert people.client.get(path, headers=people.headers["a"]).json()["name"] == "Land group"
    assert (
        people.client.patch(path, headers=people.headers["b"], json={"name": "No"}).status_code
        == 403
    )
    assert (
        people.client.post(
            path + "/members", headers=people.headers["b"], json={"user_id": people.ids["d"]}
        ).status_code
        == 403
    )
    assert (
        people.client.patch(
            path + "/members/" + people.ids["b"],
            headers=people.headers["a"],
            json={"role": "admin"},
        ).status_code
        == 200
    )
    assert (
        people.client.patch(path, headers=people.headers["b"], json={"name": "Renamed"}).status_code
        == 200
    )
    assert (
        people.client.post(
            path + "/members", headers=people.headers["b"], json={"user_id": people.ids["d"]}
        ).status_code
        == 200
    )
    assert (
        people.client.patch(
            path + "/members/" + people.ids["c"],
            headers=people.headers["b"],
            json={"role": "admin"},
        ).status_code
        == 403
    )
    assert (
        people.client.delete(
            path + "/members/" + people.ids["b"], headers=people.headers["a"]
        ).status_code
        == 204
    )
    assert people.client.get(path, headers=people.headers["b"]).status_code == 404
    assert send(people, conversation, actor="b").status_code == 404
    assert people.client.get(path + "/messages", headers=people.headers["b"]).status_code == 404
    assert (
        people.client.delete(path + "/members/me", headers=people.headers["a"]).status_code == 409
    )
    assert (
        people.client.post(
            path + "/ownership", headers=people.headers["a"], json={"user_id": people.ids["c"]}
        ).json()["owner_id"]
        == people.ids["c"]
    )
    assert (
        people.client.delete(path + "/members/me", headers=people.headers["a"]).status_code == 204
    )
    assert (
        people.client.patch(
            path + "/members/" + people.ids["c"],
            headers=people.headers["c"],
            json={"role": "member"},
        ).status_code
        == 409
    )


def test_direct_members_cannot_be_changed(people):
    path = "/conversations/" + direct(people)
    assert (
        people.client.delete(path + "/members/me", headers=people.headers["a"]).status_code == 409
    )
    assert (
        people.client.post(
            path + "/members", headers=people.headers["a"], json={"user_id": people.ids["c"]}
        ).status_code
        == 409
    )


def test_blocking_and_privacy_prevent_new_direct_messages_and_invitations(people):
    conversation = direct(people)
    assert send(people, conversation).status_code == 201
    block_path = "/users/me/blocks/" + people.ids["b"]
    assert people.client.put(block_path, headers=people.headers["a"]).status_code == 204
    assert people.client.put(block_path, headers=people.headers["a"]).status_code == 204
    blocked = people.client.get("/users/me/blocks", headers=people.headers["a"])
    assert len(blocked.json()["items"]) == 1 and "@example.com" not in blocked.text
    assert send(people, conversation).status_code == 403
    assert send(people, conversation, actor="b").status_code == 403
    assert (
        people.client.get(
            f"/conversations/{conversation}/messages", headers=people.headers["a"]
        ).status_code
        == 200
    )
    assert (
        people.client.post(
            "/conversations/groups",
            headers=people.headers["c"],
            json={"name": "Bypass", "member_ids": [people.ids["a"], people.ids["b"]]},
        ).status_code
        == 403
    )
    assert people.client.delete(block_path, headers=people.headers["a"]).status_code == 204
    assert send(people, conversation).status_code == 201
    preference = people.client.patch(
        "/users/me/privacy",
        headers=people.headers["b"],
        json={"allow_messages": False, "allow_calls": False},
    )
    assert preference.status_code == 200 and not preference.json()["allow_calls"]
    assert send(people, conversation).status_code == 403
    assert send(people, conversation, actor="b").status_code == 201
    assert (
        people.client.post(
            "/conversations/groups",
            headers=people.headers["c"],
            json={"name": "Private", "member_ids": [people.ids["b"]]},
        ).status_code
        == 403
    )
    assert (
        people.client.put(
            "/users/me/blocks/" + people.ids["a"], headers=people.headers["a"]
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "data", [{}, {"allow_messages": None}, {"allow_calls": "yes"}, {"role": "seller"}]
)
def test_privacy_updates_require_real_boolean_fields(people, data):
    assert (
        people.client.patch("/users/me/privacy", headers=people.headers["a"], json=data).status_code
        == 422
    )


def test_existing_shared_group_remains_shared_after_a_block(people):
    conversation = group(people)
    assert (
        people.client.put(
            "/users/me/blocks/" + people.ids["b"], headers=people.headers["a"]
        ).status_code
        == 204
    )
    assert send(people, conversation, actor="b").status_code == 201
    assert (
        people.client.get(
            f"/conversations/{conversation}/messages", headers=people.headers["a"]
        ).json()["items"][0]["body"]
        == "Hello"
    )


def test_members_and_group_inputs_are_bounded(people):
    assert (
        people.client.post(
            "/conversations/groups",
            headers=people.headers["a"],
            json={"name": " ", "member_ids": [people.ids["b"]]},
        ).status_code
        == 422
    )
    assert (
        people.client.post(
            "/conversations/groups",
            headers=people.headers["a"],
            json={"name": "Group", "member_ids": [people.ids["b"], people.ids["b"]]},
        ).status_code
        == 422
    )
    conversation = group(people)
    with Session(people.engine) as db:
        for index in range(47):
            user = User(
                email=f"limit{index}@example.com",
                display_name="Member",
                role=Role.buyer,
                password_hash="not-used-in-chat-tests",
            )
            db.add(user)
            db.flush()
            db.add(ConversationMember(conversation_id=uuid.UUID(conversation), user_id=user.id))
        db.commit()
    assert (
        people.client.post(
            f"/conversations/{conversation}/members",
            headers=people.headers["a"],
            json={"user_id": people.ids["d"]},
        ).status_code
        == 409
    )


def test_failed_commit_does_not_save_message_or_outbox(people, monkeypatch):
    conversation = direct(people)
    with Session(people.engine) as db:
        count = db.scalar(select(func.count(ChatOutbox.id)))
    with pytest.raises(SQLAlchemyError), Session(people.engine) as db:

        def fail():
            raise SQLAlchemyError("test failure")

        monkeypatch.setattr(db, "commit", fail)
        chat.send_message(
            db,
            uuid.UUID(conversation),
            uuid.UUID(people.ids["a"]),
            MessageCreate(client_id=uuid.uuid4(), body="atomic"),
        )
    with Session(people.engine) as db:
        assert db.scalar(select(func.count(Message.id))) == 0
        assert db.scalar(select(func.count(ChatOutbox.id))) == count


def test_outbox_retries_without_losing_history_and_contains_no_text(people):
    conversation = direct(people)
    message = send(people, conversation, body="private message").json()

    class Publisher:
        def __init__(self, fail=False):
            self.fail = fail
            self.payloads = []

        def pipeline(self, transaction):
            return self

        def publish(self, channel, payload):
            self.payloads.append((channel, payload))

        def execute(self):
            if self.fail:
                raise RedisConnectionError("simulated outage")

    def factory():
        return Session(people.engine)

    with pytest.raises(RedisConnectionError):
        flush_outbox(factory, Publisher(fail=True), "test:chat")
    with Session(people.engine) as db:
        assert db.get(Message, message["id"]).body == "private message"
        assert all(row.published_at is None for row in db.scalars(select(ChatOutbox)).all())
    publisher = Publisher()
    assert flush_outbox(factory, publisher, "test:chat") == 2
    assert all("private message" not in payload for _, payload in publisher.payloads)
    assert all(channel.startswith("test:chat:user:") for channel, _ in publisher.payloads)
    assert flush_outbox(factory, publisher, "test:chat") == 0


def test_removed_member_is_not_authorized_for_message_notifications(people):
    conversation = group(people)
    message = send(people, conversation).json()
    people.client.delete(
        f"/conversations/{conversation}/members/{people.ids['b']}", headers=people.headers["a"]
    )
    event = ChatEvent(
        event_id=uuid.uuid4(),
        type="message.created",
        conversation_id=conversation,
        actor_id=people.ids["a"],
        message_id=message["id"],
    )
    with Session(people.engine) as db:
        assert not chat.may_notify(db, uuid.UUID(people.ids["b"]), event)
        assert chat.may_notify(db, uuid.UUID(people.ids["c"]), event)


@pytest.mark.parametrize(
    "payload", [{"type": "auth", "token": "bad"}, {"type": "subscribe", "channel": "x"}]
)
def test_websocket_authentication_and_protocol_reject_untrusted_input(people, payload):
    with people.client.websocket_connect("/ws/chat") as socket:
        socket.send_json(payload)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


def test_authenticated_socket_uses_rest_for_sends(people):
    with people.client.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": people.tokens["a"]})
        assert socket.receive_json() == {"type": "ready", "user_id": people.ids["a"]}
        socket.send_json({"type": "send", "body": "bypass"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


def test_websocket_origin_is_checked(people):
    with pytest.raises(WebSocketDisconnect):
        with people.client.websocket_connect(
            "/ws/chat", headers={"Origin": "https://untrusted.example"}
        ):
            pass


@pytest.mark.parametrize(
    "url,origin",
    [
        ("ws://testserver/ws/chat", "http://testserver"),
        ("wss://testserver/ws/chat", "https://testserver"),
    ],
)
def test_native_socket_accepts_exact_api_origin_but_still_authenticates(people, url, origin):
    with people.client.websocket_connect(url, headers={"Origin": origin}) as socket:
        socket.send_json({"type": "auth", "token": people.tokens["a"]})
        assert socket.receive_json() == {"type": "ready", "user_id": people.ids["a"]}
    with people.client.websocket_connect(url, headers={"Origin": origin}) as socket:
        socket.send_json({"type": "auth", "token": "invalid"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


def test_connected_socket_expires(people):
    issued = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": people.ids["a"],
            "iat": issued,
            "exp": issued + timedelta(seconds=2),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "token_use": "access",
        },
        get_settings().jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    with people.client.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": token})
        assert socket.receive_json()["type"] == "ready"
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


def test_slow_socket_queue_is_bounded(people):
    async def check():
        hub = ChatHub(get_settings(), lambda: Session(people.engine))
        user_id = uuid.UUID(people.ids["a"])
        queue = hub.attach(user_id)
        event = ChatEvent(
            event_id=uuid.uuid4(),
            type="conversation.updated",
            conversation_id=uuid.uuid4(),
            actor_id=user_id,
        )
        for _ in range(101):
            hub._enqueue(user_id, event)
        assert queue.qsize() == 1 and await queue.get() is None
        await hub.close()

    asyncio.run(check())
