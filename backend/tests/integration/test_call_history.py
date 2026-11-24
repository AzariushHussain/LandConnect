import pytest
from sqlalchemy.orm import Session

from app.schemas.call_history import HistoryFilters
from app.services.call_history import history
from tests.history_fixtures import seed_history

pytestmark = pytest.mark.postgres


def test_history_union_and_pagination_on_postgres(migrated_database):
    engine, _ = migrated_database
    data = seed_history(engine)
    with Session(engine) as db:
        result = history(db, data.users[0], HistoryFilters(limit=2))
        assert [row.id for row in result.items] == [data.missed, data.group_call]
        assert result.has_more
        assert history(db, data.users[0], HistoryFilters(offset=2)).items[0].id == data.direct
        assert (
            history(db, data.users[0], HistoryFilters(missed_only=True)).items[0].id == data.missed
        )
