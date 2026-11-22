import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.models import Block, User


def lock_users(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    rows = db.scalars(
        select(User)
        .where(User.id.in_(ids))
        .order_by(User.id)
        .with_for_update(of=User)
        .execution_options(populate_existing=True)
    ).all()
    if len(rows) != len(ids):
        raise NotFound("User not found")
    return {row.id: row for row in rows}


def any_blocked(db: Session, ids: set[uuid.UUID]) -> bool:
    return (
        db.scalar(
            select(Block.blocker_id)
            .where(Block.blocker_id.in_(ids), Block.blocked_id.in_(ids))
            .limit(1)
        )
        is not None
    )
