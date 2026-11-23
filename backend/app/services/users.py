import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Block, User


def search_recipients(db: Session, actor: uuid.UUID, query: str) -> list[User]:
    blocked = (
        select(Block.blocked_id)
        .where(Block.blocker_id == actor)
        .union(select(Block.blocker_id).where(Block.blocked_id == actor))
    )
    return list(
        db.scalars(
            select(User)
            .where(
                User.id != actor,
                User.allow_messages.is_(True),
                User.id.not_in(blocked),
                or_(
                    User.display_name.icontains(query, autoescape=True),
                    func.lower(User.email) == query.lower(),
                ),
            )
            .order_by(func.lower(User.display_name), User.id)
            .limit(21)
        ).all()
    )
