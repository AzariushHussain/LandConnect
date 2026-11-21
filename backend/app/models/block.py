import uuid

from sqlalchemy import CheckConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Block(Base):
    __tablename__ = "blocks"
    blocker_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    __table_args__ = (CheckConstraint("blocker_id != blocked_id", name="not_self"),)
