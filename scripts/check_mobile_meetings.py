"""Check real invite-only meeting routes/mobile DTOs without developer data or live media."""

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
    "isolated-meetings-contract-signing-secret-at-least-32-characters"
)
os.environ["LIVEKIT_API_KEY"] = "isolated-meetings-contract"
os.environ["LIVEKIT_API_SECRET"] = (
    "isolated-meetings-contract-media-secret-at-least-32-characters"
)
os.environ["LIVEKIT_PUBLIC_URL"] = "wss://media.example.com"

from app.api.errors import service_error
from app.api.routes import meetings, websocket
from app.api.routes.users import router as users_router
from app.core.config import get_settings
from app.core.errors import ServiceError
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.models import ChatOutbox, Meeting, Role, User
from app.schemas.events import event_adapter
from app.services.meetings import cleanup
from app.services.realtime import ChatHub
from tests.fakes import FakeRooms


def main() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    hub = ChatHub(get_settings(), lambda: Session(engine))
    hub.ready = True  # Real socket authorization with a manually injected outbox event.
    websocket.HEARTBEAT_SECONDS = 0.1
    rooms = FakeRooms(get_settings())

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await hub.close()

    app = FastAPI(lifespan=lifespan)
    app.state.chat, app.state.calls = hub, SimpleNamespace(rooms=rooms)
    for router in (meetings.router, users_router, websocket.router):
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
                    email=f"meeting-contract-{n}@example.com",
                    display_name=f"Meeting person {n}",
                    role=role,
                    password_hash="unused-synthetic-account",
                )
                for n, role in enumerate(
                    [Role.buyer, Role.seller, Role.broker, Role.buyer]
                )
            ]
            db.add_all(people)
            db.flush()
            ids = [str(user.id) for user in people]
            tokens = [create_access_token(user.id)[0] for user in people]
            headers = [{"Authorization": "Bearer " + token} for token in tokens]
            db.commit()
        payload = {"actor": ids[0], "guest": ids[1]}
        with TestClient(app) as client:
            attempt = {
                "client_id": str(uuid.uuid4()),
                "title": "Land discussion",
                "kind": "video",
                "member_ids": ids[1:3],
            }
            created = client.post("/meetings", headers=headers[0], json=attempt)
            assert created.status_code == 201, created.text
            payload["created"] = created.json()
            meeting_id = created.json()["id"]
            path = f"/meetings/{meeting_id}"

            def action(name, actor=0):
                return client.post(f"{path}/{name}", headers=headers[actor])

            def clean_retired():
                with Session(engine) as db:
                    assert cleanup(db, db.get(Meeting, uuid.UUID(meeting_id)), rooms)

            assert (
                client.post("/meetings", headers=headers[0], json=attempt).json()["id"]
                == meeting_id
            )
            assert action("token", 1).status_code == 403
            assert client.get(path, headers=headers[3]).status_code == 404
            assert action("end", 1).status_code == 403
            assert client.get("/meetings").status_code == 401
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
                            frame["type"] == "meeting.invited"
                            and frame["meeting_id"] == meeting_id
                        )
                        break
            for guest in (1, 2):
                accepted = action("accept", guest)
                assert accepted.status_code == 200, accepted.text
            payload["accepted"] = accepted.json()
            for actor in (0, 1, 2):
                media = action("token", actor)
                assert media.status_code == 200, media.text
                if actor == 0:
                    payload["media"] = media.json()
            rooms.fail.add("close")
            removed = client.delete(f"{path}/members/{ids[2]}", headers=headers[0])
            assert removed.status_code == 202 and not removed.content
            payload["retiring"] = client.get(path, headers=headers[0]).json()
            assert payload["retiring"]["media_cleanup_pending"]
            assert payload["retiring"]["room_version"] == 2
            assert action("token").status_code == 503
            assert action("token", 2).status_code == 404
            rooms.fail.clear()
            clean_retired()
            payload["rotated"] = client.get(path, headers=headers[0]).json()
            payload["newMedia"] = action("token").json()
            assert payload["newMedia"]["room"] != payload["media"]["room"]
            assert action("leave", 1).status_code == 204
            assert action("token", 1).status_code == 200  # Leave retains consent.
            rooms.fail.add("close")
            declined = action("decline", 1)
            assert declined.status_code == 202 and not declined.content
            assert client.get(path, headers=headers[1]).status_code == 404
            assert action("accept", 1).status_code == 404
            rooms.fail.clear()
            clean_retired()
            reinvite = client.post(
                f"{path}/members", headers=headers[0], json={"user_id": ids[1]}
            )
            assert reinvite.status_code == 200
            assert action("accept", 1).status_code == 200
            assert action("token").status_code == 200
            ended = action("end")
            assert ended.status_code == 200 and ended.json()["ended_at"]
            payload["ended"] = ended.json()
            assert action("token").status_code == 409
            payload["history"] = client.get(
                "/meetings?limit=20&offset=0&status=ended", headers=headers[0]
            ).json()
            private = client.post(
                "/meetings",
                headers=headers[0],
                json={**attempt, "client_id": str(uuid.uuid4())},
            )
            assert private.status_code == 201
            private_path = "/meetings/" + private.json()["id"]
            assert (
                client.patch(
                    "/users/me/privacy", headers=headers[1], json={"allow_calls": False}
                ).status_code
                == 200
            )
            assert client.get(private_path, headers=headers[1]).status_code == 404
            assert (
                client.post(
                    private_path + "/members",
                    headers=headers[0],
                    json={"user_id": ids[1]},
                ).status_code
                == 403
            )
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
            assert (
                client.post(
                    private_path + "/members",
                    headers=headers[0],
                    json={"user_id": ids[1]},
                ).status_code
                == 403
            )
        subprocess.run(
            ["node", "--import", "tsx", "tests/verify-meetings-contract.ts"],
            cwd=ROOT / "mobile",
            input=json.dumps(payload),
            text=True,
            check=True,
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
