"""Check real chat routes and socket protocol against mobile parsers, without developer data."""

import json
import os
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = (
    "isolated-chat-contract-signing-secret-at-least-32-characters"
)
os.environ["LIVEKIT_API_KEY"] = "isolated-contract"
os.environ["LIVEKIT_API_SECRET"] = (
    "isolated-contract-media-secret-at-least-32-characters"
)

from app.api.errors import service_error
from app.api.routes import conversations, websocket
from app.core.config import get_settings
from app.core.errors import ServiceError
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.models import ChatOutbox, Role, User
from app.schemas.events import event_adapter
from app.services.realtime import ChatHub


def main() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    hub = ChatHub(get_settings(), lambda: Session(engine))
    # This probe exercises the real socket route, not a Redis connection or relay.
    hub.ready = True
    websocket.HEARTBEAT_SECONDS = 0.1

    @asynccontextmanager
    async def lifespan(_application):
        yield
        await hub.close()

    app = FastAPI(lifespan=lifespan)
    app.state.chat = hub
    app.include_router(conversations.router)
    app.include_router(websocket.router)
    app.add_exception_handler(ServiceError, service_error)

    def database():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = database
    try:
        with Session(engine) as db:
            users = [
                User(
                    email=f"chat-contract-{n}@example.com",
                    display_name=f"Contract {n}",
                    role=role,
                    password_hash="unused-test-only",
                )
                for n, role in enumerate(
                    [Role.buyer, Role.seller, Role.broker, Role.buyer]
                )
            ]
            db.add_all(users)
            db.flush()
            ids = [str(user.id) for user in users]
            tokens = [create_access_token(user.id)[0] for user in users]
            headers = [{"Authorization": f"Bearer {token}"} for token in tokens]
            db.commit()
        payload = {"actor": ids[0]}
        with TestClient(app) as client:
            direct = client.post(
                "/conversations/direct",
                json={"recipient_id": ids[1]},
                headers=headers[0],
            )
            assert direct.status_code == 201, direct.text
            chat = direct.json()["id"]
            payload["direct"] = direct.json()
            repeat = client.post(
                "/conversations/direct",
                json={"recipient_id": ids[0]},
                headers=headers[1],
            )
            assert repeat.status_code == 200 and repeat.json()["id"] == chat
            path = f"/conversations/{chat}/messages"
            first_id = str(uuid.uuid4())
            for n in range(55):
                sent = client.post(
                    path,
                    json={
                        "client_id": first_id if n == 0 else str(uuid.uuid4()),
                        "body": f"Synthetic message {n}",
                    },
                    headers=headers[0],
                )
                assert sent.status_code == 201, sent.text
            retry = client.post(
                path,
                json={"client_id": first_id, "body": "Synthetic message 0"},
                headers=headers[0],
            )
            assert retry.status_code == 200
            payload["saved"] = retry.json()
            assert (
                client.post(
                    path,
                    json={"client_id": first_id, "body": "Different text"},
                    headers=headers[0],
                ).status_code
                == 409
            )
            latest = client.get(path, headers=headers[0]).json()
            payload["latest"] = latest
            payload["older"] = client.get(
                path, params={"before_id": latest["next_before_id"]}, headers=headers[0]
            ).json()
            payload["catchup"] = client.get(
                path, params={"after_id": 0}, headers=headers[0]
            ).json()
            payload["catchupLast"] = client.get(
                path,
                params={"after_id": payload["catchup"]["next_after_id"]},
                headers=headers[0],
            ).json()
            assert client.get(path, headers=headers[3]).status_code == 404
            assert client.get("/conversations").status_code == 401
            with Session(engine) as db:
                events = db.scalars(select(ChatOutbox)).all()
                record = next(
                    event
                    for event in events
                    if event.event.get("message_id") == retry.json()["id"]
                )
                hint = event_adapter.validate_python(record.event)
            with client.websocket_connect(
                "/ws/chat", headers={"Origin": "http://testserver"}
            ) as socket:
                socket.send_json({"type": "auth", "token": tokens[0]})
                assert socket.receive_json() == {"type": "ready", "user_id": ids[0]}
                assert socket.receive_json() == {"type": "ping"}
                socket.send_json({"type": "pong"})
                client.portal.call(hub._enqueue, uuid.UUID(ids[0]), hint)
                while True:
                    frame = socket.receive_json()
                    if frame["type"] == "ping":
                        socket.send_json({"type": "pong"})
                    else:
                        payload["hint"] = frame
                        break
            try:
                with client.websocket_connect(
                    "/ws/chat", headers={"Origin": "https://untrusted.example"}
                ):
                    raise AssertionError("Untrusted socket origin was accepted")
            except WebSocketDisconnect:
                pass
            group = client.post(
                "/conversations/groups",
                json={"name": "  Mobile group  ", "member_ids": ids[1:3]},
                headers=headers[0],
            )
            assert group.status_code == 201, group.text
            payload["group"] = group.json()
            group_path = f"/conversations/{group.json()['id']}"
            assert (
                client.patch(
                    group_path, json={"name": "Not allowed"}, headers=headers[2]
                ).status_code
                == 403
            )
            assert (
                client.delete(
                    f"{group_path}/members/me", headers=headers[0]
                ).status_code
                == 409
            )
            assert (
                client.patch(
                    f"{group_path}/members/{ids[1]}",
                    json={"role": "admin"},
                    headers=headers[0],
                ).status_code
                == 200
            )
            assert (
                client.delete(
                    f"{group_path}/members/{ids[2]}", headers=headers[1]
                ).status_code
                == 204
            )
            assert (
                client.get(f"{group_path}/messages", headers=headers[2]).status_code
                == 404
            )
            assert (
                client.post(
                    f"{group_path}/members",
                    json={"user_id": ids[2]},
                    headers=headers[0],
                ).status_code
                == 200
            )
            transferred = client.post(
                f"{group_path}/ownership", json={"user_id": ids[1]}, headers=headers[0]
            )
            assert transferred.status_code == 200
            payload["transferred"] = transferred.json()
            assert (
                client.delete(
                    f"{group_path}/members/me", headers=headers[0]
                ).status_code
                == 204
            )
            assert client.get(group_path, headers=headers[0]).status_code == 404
            assert (
                client.post(
                    f"{group_path}/members",
                    json={"user_id": ids[0]},
                    headers=headers[1],
                ).status_code
                == 200
            )
            assert (
                client.delete(
                    f"{group_path}/members/{ids[0]}", headers=headers[1]
                ).status_code
                == 204
            )
            payload["inbox"] = client.get("/conversations", headers=headers[0]).json()
        subprocess.run(
            ["node", "--import", "tsx", "tests/verify-chat-contract.ts"],
            cwd=ROOT / "mobile",
            input=json.dumps(payload),
            text=True,
            check=True,
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
