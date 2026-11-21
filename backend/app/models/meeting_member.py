import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MeetingMember(Base):
    __tablename__ = "meeting_members"
    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
