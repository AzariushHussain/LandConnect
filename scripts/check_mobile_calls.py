"""Exercise real call routes/mobile DTOs with synthetic accounts and fake media rooms."""

import json
import os
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = (
    "isolated-calls-contract-signing-secret-at-least-32-characters"
)
os.environ["LIVEKIT_API_KEY"] = "isolated-contract"
os.environ["LIVEKIT_API_SECRET"] = (
    "isolated-calls-contract-media-secret-at-least-32-characters"
)
os.environ["LIVEKIT_PUBLIC_URL"] = "wss://media.example.com"

from app.api.errors import service_error
from app.api.routes import calls, websocket
from app.api.routes.users import router as users_router
from app.core.config import get_settings
from app.core.errors import ServiceError
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.models import ChatOutbox, Role, User
from app.schemas.events import event_adapter
from app.services.realtime import ChatHub
from tests.fakes import FakeRooms


def main() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    hub = ChatHub(get_settings(), lambda: Session(engine))
    hub.ready = True  # Real socket authorization, without a Redis relay connection.
    websocket.HEARTBEAT_SECONDS = 0.1
    rooms = FakeRooms(get_settings())

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await hub.close()

    app = FastAPI(lifespan=lifespan)
    app.state.chat = hub
    app.state.calls = SimpleNamespace(rooms=rooms)
    for router in (calls.router, users_router, websocket.router):
        app.include_router(router)
    app.add_exception_handler(ServiceError, service_error)

    def database():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = database
    try:
        with Session(engine) as db:
            people = [
                User(
                    email=f"call-contract-{n}@example.com",
                    display_name=f"Caller {n}",
                    role=role,
                    password_hash="unused-synthetic-account",
                )
                for n, role in enumerate(Role)
            ]
            db.add_all(people)
            db.flush()
            ids = [str(user.id) for user in people]
            tokens = [create_access_token(user.id)[0] for user in people]
            headers = [{"Authorization": "Bearer " + token} for token in tokens]
            db.commit()
        payload = {"actor": ids[0], "calls": []}
        with TestClient(app) as client:

            def begin(kind="video", client_id=None):
                return client.post(
                    "/calls",
                    headers=headers[0],
                    json={
                        "callee_id": ids[1],
                        "kind": kind,
                        "client_id": client_id or str(uuid.uuid4()),
                    },
                )

            def action(call_id, name, actor=0):
                return client.post(f"/calls/{call_id}/{name}", headers=headers[actor])

            retry_id = str(uuid.uuid4())
            created = begin(client_id=retry_id)
            assert created.status_code == 201, created.text
            call_id = created.json()["id"]
            payload["calls"].append(created.json())
            assert begin(client_id=retry_id).json()["id"] == call_id
            assert begin().status_code == 409
            assert (
                client.get(f"/calls/{call_id}", headers=headers[2]).status_code == 404
            )
            assert action(call_id, "accept").status_code == 403
            assert action(call_id, "token").status_code == 409
            assert client.get("/calls").status_code == 401
            with Session(engine) as db:
                outbox = db.scalar(select(ChatOutbox).order_by(ChatOutbox.created_at))
                hint = event_adapter.validate_python(outbox.event)
            with client.websocket_connect(
                "/ws/chat", headers={"Origin": "http://testserver"}
            ) as socket:
                socket.send_json({"type": "auth", "token": tokens[1]})
                assert socket.receive_json() == {"type": "ready", "user_id": ids[1]}
                client.portal.call(hub._enqueue, uuid.UUID(ids[1]), hint)
                while True:
                    frame = socket.receive_json()
                    if frame["type"] == "ping":
                        socket.send_json({"type": "pong"})
                    else:
                        payload["hint"] = frame
                        assert (
                            frame["type"] == "call.incoming"
                            and frame["call_id"] == call_id
                        )
                        break
            accepted = action(call_id, "accept", 1)
            assert accepted.status_code == 200, accepted.text
            payload["calls"].append(accepted.json())
            media = action(call_id, "token")
            assert media.status_code == 200
            payload["media"] = media.json()
            assert action(call_id, "token", 2).status_code == 404
            ended = action(call_id, "end")
            assert ended.status_code == 200 and ended.json()["status"] == "ended"
            payload["calls"].append(ended.json())
            assert action(call_id, "end").status_code == 200
            assert action(call_id, "token").status_code == 409
            rejected_id = begin("audio").json()["id"]
            rejected = action(rejected_id, "reject", 1)
            assert rejected.status_code == 200
            payload["calls"].append(rejected.json())
            cancelled_id = begin("audio").json()["id"]
            cancelled = action(cancelled_id, "cancel")
            assert cancelled.status_code == 200
            payload["calls"].append(cancelled.json())
            private_id = begin().json()["id"]
            assert action(private_id, "accept", 1).status_code == 200
            assert (
                client.patch(
                    "/users/me/privacy", headers=headers[1], json={"allow_calls": False}
                ).status_code
                == 200
            )
            assert (
                client.get(f"/calls/{private_id}", headers=headers[0]).json()["status"]
                == "ended"
            )
            assert action(private_id, "token").status_code == 409
            assert begin().status_code == 403
            assert (
                client.patch(
                    "/users/me/privacy", headers=headers[1], json={"allow_calls": True}
                ).status_code
                == 200
            )
            assert (
                client.put(f"/users/me/blocks/{ids[0]}", headers=headers[1]).status_code
                == 204
            )
            assert begin().status_code == 403
        subprocess.run(
            ["node", "--import", "tsx", "tests/verify-calls-contract.ts"],
            cwd=ROOT / "mobile",
            input=json.dumps(payload),
            text=True,
            check=True,
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
