import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.errors import NotFound
from app.models import Meeting, Role, User
from app.schemas.meeting import MeetingCreate
from app.services import meetings
from app.services.privacy import lock_users
from tests.fakes import FakeRooms
from tests.integration.test_realtime import receive_event
from tests.integration.test_realtime import servers as servers

pytestmark = pytest.mark.postgres


@pytest.mark.realtime
@pytest.mark.calling
def test_meeting_events_and_removal_cross_instances(servers):
    a, b, ids, tokens, headers, _, _ = servers
    rooms = FakeRooms(get_settings())
    a.app.state.calls.rooms = b.app.state.calls.rooms = rooms
    with b.websocket_connect("/ws/chat") as socket:
        socket.send_json({"type": "auth", "token": tokens["b"]})
        assert socket.receive_json()["type"] == "ready"
        created = a.post(
            "/meetings",
            headers=headers["a"],
            json={
                "client_id": str(uuid.uuid4()),
                "title": "Shared meeting",
                "member_ids": [ids["b"], ids["c"]],
            },
        )
        assert created.status_code == 201
        mid = created.json()["id"]
        path = "/meetings/" + mid
        assert receive_event(socket, "meeting.invited")["meeting_id"] == mid
        assert b.post(path + "/token", headers=headers["b"]).status_code == 403
        assert b.post(path + "/accept", headers=headers["b"]).status_code == 200
        old_room = b.post(path + "/token", headers=headers["b"]).json()["room"]
        assert a.delete(path + "/members/" + ids["b"], headers=headers["a"]).status_code == 204
        assert receive_event(socket, "meeting.member_removed")["target_user_id"] == ids["b"]
        assert b.get(path, headers=headers["b"]).status_code == 404
        assert b.post(path + "/token", headers=headers["b"]).status_code == 404
        assert old_room not in rooms.live
        assert a.post(path + "/token", headers=headers["a"]).json()["room"] != old_room


def test_waiting_join_rechecks_membership_after_removal(migrated_database):
    engine, _ = migrated_database
    factory = sessionmaker(engine, expire_on_commit=False)
    rooms = FakeRooms(get_settings())
    with factory() as db:
        users = [
            User(
                email=f"{i}@example.com",
                display_name=str(i),
                role=Role.buyer,
                password_hash="unused",
            )
            for i in range(2)
        ]
        db.add_all(users)
        db.commit()
        owner, member = [user.id for user in users]
        meeting, _ = meetings.create(
            db,
            owner,
            MeetingCreate(client_id=uuid.uuid4(), title="Concurrent", member_ids=[member]),
        )
        mid = meeting.id
        meetings.accept(db, mid, member)
    pid_queue = Queue()

    def join():
        with factory() as db:
            pid_queue.put(db.scalar(text("SELECT pg_backend_pid()")))
            with pytest.raises(NotFound):
                meetings.token(db, mid, member, rooms)

    with ThreadPoolExecutor(max_workers=1) as pool, factory() as remover:
        lock_users(remover, {owner, member})
        remover.scalar(select(Meeting).where(Meeting.id == mid).with_for_update(of=Meeting))
        pending = pool.submit(join)
        pid = pid_queue.get(timeout=5)
        with factory() as observer:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if observer.scalar(
                    text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
                ):
                    break
                time.sleep(0.02)
            else:
                remover.rollback()
                pytest.fail("Join did not wait for the locked membership operation")
        meetings.remove(remover, mid, owner, member, rooms)
        pending.result(timeout=5)
