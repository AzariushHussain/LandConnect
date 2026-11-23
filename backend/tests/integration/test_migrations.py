import uuid
from decimal import Decimal

import pytest
from sqlalchemy import insert, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.models import (
    Block,
    Conversation,
    ConversationKind,
    ConversationMember,
    Listing,
    Message,
    Role,
    User,
)

pytestmark = pytest.mark.postgres


def test_migrations_match_models_and_round_trip(migrated_database):
    db, config = migrated_database
    expected_tables = {
        "users",
        "blocks",
        "listings",
        "listing_images",
        "conversations",
        "messages",
        "calls",
        "meetings",
        "meeting_members",
        "alembic_version",
        "conversation_members",
        "chat_outbox",
    }
    assert set(inspect(db).get_table_names()) == expected_tables
    command.check(config)
    command.downgrade(config, "base")
    assert set(inspect(db).get_table_names()) == {"alembic_version"}
    command.upgrade(config, "head")
    with db.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0005_group_calls"
        )
    assert set(inspect(db).get_table_names()) == expected_tables


def test_meeting_migration_backfills_owner_and_preserves_old_members(migrated_database):
    engine, config = migrated_database
    command.downgrade(config, "0003_calls")
    owner, member, mid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        for user_id in (owner, member):
            connection.execute(
                insert(User).values(
                    id=user_id,
                    email=str(user_id) + "@example.com",
                    display_name="Legacy",
                    role=Role.buyer,
                    password_hash="unused",
                )
            )
        connection.execute(
            text(
                "INSERT INTO meetings (id, owner_id, title, created_at) "
                "VALUES (:id, :owner, 'Legacy', CURRENT_TIMESTAMP)"
            ),
            {"id": mid, "owner": owner},
        )
        connection.execute(
            text("INSERT INTO meeting_members (meeting_id, user_id) VALUES (:id, :member)"),
            {"id": mid, "member": member},
        )
    command.upgrade(config, "head")
    with engine.connect() as connection:
        members = connection.execute(
            text("SELECT user_id, status FROM meeting_members WHERE meeting_id=:id"), {"id": mid}
        ).all()
        assert set(members) == {(owner, "accepted"), (member, "accepted")}
        assert (
            connection.scalar(text("SELECT room_version FROM meetings WHERE id=:id"), {"id": mid})
            == 1
        )
    with pytest.raises(RuntimeError, match="open meetings"):
        command.downgrade(config, "0003_calls")
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE meetings SET ended_at=CURRENT_TIMESTAMP, "
                "room_closed_at=CURRENT_TIMESTAMP WHERE id=:id"
            ),
            {"id": mid},
        )
    command.downgrade(config, "0003_calls")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT title FROM meetings WHERE id=:id"), {"id": mid})
            == "Legacy"
        )
    command.upgrade(config, "head")
    command.check(config)


def test_database_rejects_invalid_marketplace_data(migrated_database):
    db, _ = migrated_database
    with Session(db, expire_on_commit=False) as session:
        buyer = User(
            email="buyer@example.com",
            password_hash="test-hash",
            display_name="Buyer",
            role=Role.buyer,
        )
        seller = User(
            email="seller@example.com",
            password_hash="test-hash",
            display_name="Seller",
            role=Role.seller,
        )
        session.add_all([buyer, seller])
        session.commit()

        for invalid in (
            User(
                email=buyer.email,
                password_hash="test-hash",
                display_name="Duplicate",
                role=Role.buyer,
            ),
            User(
                email="invalid@example.com",
                password_hash="test-hash",
                display_name="Invalid",
                role="admin",
            ),
            Block(blocker_id=buyer.id, blocked_id=buyer.id),
            Conversation(user_a_id=buyer.id, user_b_id=buyer.id),
        ):
            session.add(invalid)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()

        fields = dict(
            owner_id=seller.id,
            title="Test land",
            description="Test description",
            price=Decimal("1000.00"),
            area_sq_m=Decimal("100.00"),
            address="Test address",
            city="Test city",
            state="Test state",
            latitude=Decimal("12.000000"),
            longitude=Decimal("77.000000"),
        )
        for invalid_values in (
            {"price": 0},
            {"area_sq_m": -1},
            {"latitude": 91},
            {"longitude": 181},
        ):
            session.add(Listing(**(fields | invalid_values)))
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()


def test_chat_migration_preserves_old_direct_history_and_guards_group_downgrade(migrated_database):
    db, config = migrated_database
    command.downgrade(config, "0001_initial")
    a, b = sorted((uuid.uuid4(), uuid.uuid4()))
    conversation = uuid.uuid4()
    with db.begin() as connection:
        for user_id, email in ((a, "a@example.com"), (b, "b@example.com")):
            connection.execute(
                insert(User).values(
                    id=user_id,
                    email=email,
                    display_name="Legacy",
                    role=Role.buyer,
                    password_hash="legacy-hash",
                )
            )
        connection.execute(
            text(
                "INSERT INTO conversations (id, user_a_id, user_b_id, created_at) "
                "VALUES (:id, :a, :b, CURRENT_TIMESTAMP)"
            ),
            {"id": conversation, "a": a, "b": b},
        )
        connection.execute(
            text(
                "INSERT INTO messages (conversation_id, sender_id, body, created_at) "
                "VALUES (:conversation, :sender, 'preserved history', CURRENT_TIMESTAMP)"
            ),
            {"conversation": conversation, "sender": a},
        )
    command.upgrade(config, "head")
    with Session(db) as session:
        row = session.get(Conversation, conversation)
        assert row.kind == ConversationKind.direct
        assert {member.user_id for member in row.members} == {a, b}
        old_message = session.scalar(select(Message))
        assert old_message.body == "preserved history" and old_message.client_id is None
        group = Conversation(kind=ConversationKind.group, name="Keep group", owner_id=a)
        group.members = [ConversationMember(user_id=a)]
        session.add(group)
        session.commit()
    with pytest.raises(RuntimeError, match="group conversations"):
        command.downgrade(config, "0001_initial")
    command.check(config)


def test_call_migration_preserves_legacy_calls_and_blocks_unsafe_downgrade(migrated_database):
    db, config = migrated_database
    command.downgrade(config, "0002_chat")
    a, b, call_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with db.begin() as connection:
        for user_id, email in ((a, "a@example.com"), (b, "b@example.com")):
            connection.execute(
                insert(User).values(
                    id=user_id,
                    email=email,
                    display_name="Legacy",
                    role=Role.buyer,
                    password_hash="unused",
                )
            )
        connection.execute(
            text(
                "INSERT INTO calls (id, caller_id, callee_id, kind, status, "
                "created_at, expires_at) "
                "VALUES (:id, :a, :b, 'audio', 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": call_id, "a": a, "b": b},
        )
    command.upgrade(config, "head")
    with db.connect() as connection:
        record = (
            connection.execute(text("SELECT * FROM calls WHERE id=:id"), {"id": call_id})
            .mappings()
            .one()
        )
        assert record["status"] == "accepted" and record["client_id"] is None
        assert record["accepted_at"] == record["created_at"]
    with pytest.raises(RuntimeError, match="active calls"):
        command.downgrade(config, "0002_chat")
    with db.begin() as connection:
        connection.execute(
            text(
                "UPDATE calls SET status='ended', ended_at=CURRENT_TIMESTAMP, "
                "room_closed_at=CURRENT_TIMESTAMP WHERE id=:id"
            ),
            {"id": call_id},
        )
    command.downgrade(config, "0002_chat")
    with db.connect() as connection:
        assert (
            connection.scalar(text("SELECT status FROM calls WHERE id=:id"), {"id": call_id})
            == "ended"
        )
    command.upgrade(config, "head")
    command.check(config)
