import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import MemberRole

if TYPE_CHECKING:
    from app.models.user import User


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    role: Mapped[MemberRole] = mapped_column(enum_type(MemberRole), default=MemberRole.member)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    user: Mapped["User"] = relationship(lazy="joined")
