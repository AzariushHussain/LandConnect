import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import ConversationKind

if TYPE_CHECKING:
    from app.models.conversation_member import ConversationMember


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[ConversationKind] = mapped_column(
        enum_type(ConversationKind), default=ConversationKind.direct
    )
    name: Mapped[str | None] = mapped_column(String(100))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    user_a_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    user_b_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    members: Mapped[list["ConversationMember"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ConversationMember.user_id"
    )
    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id"),
        CheckConstraint("user_a_id < user_b_id", name="ordered_pair"),
        CheckConstraint(
            "(kind = 'direct' AND user_a_id IS NOT NULL AND user_b_id IS NOT NULL "
            "AND owner_id IS NULL AND name IS NULL) OR "
            "(kind = 'group' AND user_a_id IS NULL AND user_b_id IS NULL "
            "AND owner_id IS NOT NULL AND name IS NOT NULL)",
            name="conversation_shape",
        ),
    )
