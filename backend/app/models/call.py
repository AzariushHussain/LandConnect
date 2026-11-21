import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import CallKind, CallStatus


class Call(Base):
    __tablename__ = "calls"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    caller_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    callee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[CallKind] = mapped_column(enum_type(CallKind))
    status: Mapped[CallStatus] = mapped_column(enum_type(CallStatus), default=CallStatus.ringing)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (CheckConstraint("caller_id != callee_id", name="not_self"),)
