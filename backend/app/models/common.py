import enum
from datetime import UTC, datetime

from sqlalchemy import Enum


def now() -> datetime:
    return datetime.now(UTC)


def enum_type(cls: type[enum.Enum]) -> Enum:
    return Enum(
        cls,
        values_callable=lambda c: [v.value for v in c],
        native_enum=False,
        create_constraint=True,
        name=cls.__name__.lower(),
    )
