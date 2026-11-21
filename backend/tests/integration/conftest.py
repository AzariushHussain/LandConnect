import os
import uuid
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from alembic import command
from app.core.config import get_settings


@pytest.fixture
def migrated_database(monkeypatch):
    url = os.getenv("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set TEST_POSTGRES_URL to run isolated PostgreSQL integration checks")
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
