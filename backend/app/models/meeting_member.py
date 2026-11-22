import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type
from app.models.enums import MeetingMemberStatus


class MeetingMember(Base):
    __tablename__ = "meeting_members"
    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    status: Mapped[MeetingMemberStatus] = mapped_column(
        enum_type(MeetingMemberStatus), default=MeetingMemberStatus.invited
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user = relationship("User", lazy="joined")
    __table_args__ = (Index("ix_meeting_members_user_status", "user_id", "status"),)
