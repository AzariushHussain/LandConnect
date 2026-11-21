import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.errors import ChatNotFound
from app.models import Role, User
from app.schemas.chat import GroupCreate, MessageCreate
from app.services import chat

pytestmark = pytest.mark.postgres


@pytest.fixture
def group(migrated_database):
    engine, _ = migrated_database
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        people = [
            User(
                email=f"{i}@example.com",
                display_name=str(i),
                password_hash="unused",
                role=Role.buyer,
            )
            for i in range(2)
        ]
        db.add_all(people)
        db.commit()
        owner, member = [person.id for person in people]
        conversation = chat.create_group(
            db, owner, GroupCreate(name="Transactions", member_ids=[member])
        )
        return factory, conversation.id, owner, member


def test_waiting_send_rechecks_membership_after_removal_commits(group):
    factory, conversation, owner, member = group
    pid_queue = Queue()

    def send():
        with factory() as db:
            pid_queue.put(db.scalar(text("SELECT pg_backend_pid()")))
            with pytest.raises(ChatNotFound):
                chat.send_message(
                    db, conversation, member, MessageCreate(client_id=uuid.uuid4(), body="late")
                )

    with ThreadPoolExecutor(max_workers=1) as pool, factory() as remover:
        chat.get_conversation(remover, conversation, owner, write=True)
        pending = pool.submit(send)
        pid = pid_queue.get(timeout=5)
        with factory() as observer:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                waiting = observer.scalar(
                    text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
                )
                if waiting:
                    break
                time.sleep(0.02)
            else:
                remover.rollback()
                pytest.fail("The concurrent send did not wait for the conversation lock")
        chat.remove_member(remover, conversation, owner, member)
        pending.result(timeout=5)


def test_concurrent_send_retries_create_one_message(group):
    factory, conversation, owner, _ = group
    data = MessageCreate(client_id=uuid.uuid4(), body="one logical message")

    def send():
        with factory() as db:
            message, created = chat.send_message(db, conversation, owner, data)
            return message.id, created

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert results[0][0] == results[1][0]
    assert sorted(created for _, created in results) == [False, True]
