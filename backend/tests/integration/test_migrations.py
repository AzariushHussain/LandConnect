import os
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from alembic import command
from app.core.config import get_settings
from app.models import Block, Conversation, Listing, Role, User

pytestmark = pytest.mark.postgres


@pytest.fixture
def migrated_database(monkeypatch):
    url = os.getenv("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set TEST_POSTGRES_URL to run isolated PostgreSQL migration checks")
    admin = create_engine(url, connect_args={"connect_timeout": 3})
    # Each test owns a new schema; existing application tables are never downgraded.
    schema = "lc_test_" + uuid.uuid4().hex
    with admin.begin() as connection:
        connection.execute(CreateSchema(schema))
    test_url = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", test_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    test_engine = create_engine(test_url)
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    try:
        command.upgrade(config, "head")
        yield test_engine, config
    finally:
        test_engine.dispose()
        get_settings.cache_clear()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


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
    }
    assert set(inspect(db).get_table_names()) == expected_tables
    command.check(config)
    command.downgrade(config, "base")
    assert set(inspect(db).get_table_names()) == {"alembic_version"}
    command.upgrade(config, "head")
    with db.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0001_initial"
    assert set(inspect(db).get_table_names()) == expected_tables


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
