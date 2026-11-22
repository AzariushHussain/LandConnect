import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import CallKind

if TYPE_CHECKING:
    from app.models.meeting_member import MeetingMember


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(150))
    kind: Mapped[CallKind] = mapped_column(enum_type(CallKind), default=CallKind.video)
    initial_member_ids: Mapped[list[str] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    room_version: Mapped[int] = mapped_column(Integer, default=1)
    room_sid: Mapped[str | None] = mapped_column(String(64))
    retiring_room_name: Mapped[str | None] = mapped_column(String(150))
    room_closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    members: Mapped[list["MeetingMember"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="MeetingMember.user_id"
    )
    __table_args__ = (
        UniqueConstraint("owner_id", "client_id", name="uq_meetings_owner_client"),
        CheckConstraint("room_version >= 1", name="positive_room_version"),
        Index("ix_meetings_state_checked", "ended_at", "media_checked_at"),
        Index("ix_meetings_cleanup", "retiring_room_name"),
    )
