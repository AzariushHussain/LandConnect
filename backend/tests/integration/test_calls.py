import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.errors import Conflict
from app.models import Call, Role, User
from app.models.common import now
from app.schemas.call import CallCreate
from app.services import calls
from tests.fakes import FakeRooms
from tests.integration.test_realtime import receive_event
from tests.integration.test_realtime import servers as servers

pytestmark = pytest.mark.postgres


@pytest.mark.realtime
@pytest.mark.calling
def test_call_notifications_cross_api_instances_and_tokens_require_acceptance(servers):
    a, b, ids, tokens, headers, _, _ = servers
    rooms = FakeRooms(get_settings())
    a.app.state.calls.rooms = b.app.state.calls.rooms = rooms
    with b.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": tokens["b"]})
        assert socket.receive_json()["type"] == "ready"
        created = a.post(
            "/calls",
            headers=headers["a"],
            json={"client_id": str(uuid.uuid4()), "callee_id": ids["b"], "kind": "video"},
        )
        assert created.status_code == 201
        call_id = created.json()["id"]
        path = "/calls/" + call_id
        event = receive_event(socket, "call.incoming")
        assert event["call_id"] == call_id and "token" not in event
        assert a.post(path + "/token", headers=headers["a"]).status_code == 409
        assert b.post(path + "/accept", headers=headers["b"]).json()["status"] == "accepted"
        assert receive_event(socket, "call.accepted")["call_id"] == call_id
        assert a.post(path + "/token", headers=headers["a"]).status_code == 200
        assert a.post(path + "/token", headers=headers["c"]).status_code == 404
        assert b.post(path + "/end", headers=headers["b"]).json()["status"] == "ended"
        assert receive_event(socket, "call.ended")["call_id"] == call_id
        assert uuid.UUID(call_id) not in rooms.live
        ringing = a.post(
            "/calls",
            headers=headers["a"],
            json={"client_id": str(uuid.uuid4()), "callee_id": ids["b"], "kind": "audio"},
        )
        assert ringing.status_code == 201
        with a.app.state.calls.session_factory() as db:
            db.get(Call, uuid.UUID(ringing.json()["id"])).expires_at = now() - timedelta(seconds=1)
            db.commit()
        assert receive_event(socket, "call.missed")["call_id"] == ringing.json()["id"]


def test_simultaneous_opposite_calls_allow_one_active_pair(migrated_database):
    engine, _ = migrated_database
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        people = [
            User(
                email=f"{i}@example.com",
                display_name=str(i),
                role=Role.buyer,
                password_hash="unused",
            )
            for i in range(2)
        ]
        db.add_all(people)
        db.commit()
        ids = [u.id for u in people]

    def create(index):
        with factory() as db:
            try:
                result, _ = calls.create(
                    db,
                    ids[index],
                    CallCreate(client_id=uuid.uuid4(), callee_id=ids[1 - index], kind="audio"),
                    get_settings(),
                )
                return result.id
            except Conflict:
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, (0, 1)))
    assert sum(result is not None for result in results) == 1
    with factory() as db:
        assert len(db.query(Call).all()) == 1
