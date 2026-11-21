from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

database_url = get_settings().database_url
engine = create_engine(
    database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 3} if database_url.startswith("postgresql") else {},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
