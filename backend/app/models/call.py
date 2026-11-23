import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import CallKind, CallStatus


class Call(Base):
    __tablename__ = "calls"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    caller_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    callee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    kind: Mapped[CallKind] = mapped_column(enum_type(CallKind))
    status: Mapped[CallStatus] = mapped_column(enum_type(CallStatus), default=CallStatus.ringing)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    room_sid: Mapped[str | None] = mapped_column(String(64))
    room_closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media_missing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    caller = relationship("User", foreign_keys=[caller_id], lazy="joined")
    callee = relationship("User", foreign_keys=[callee_id], lazy="joined")
    __table_args__ = (
        CheckConstraint("caller_id != callee_id", name="not_self"),
        UniqueConstraint("caller_id", "client_id", name="uq_calls_caller_client"),
        Index("ix_calls_status_expires", "status", "expires_at"),
        Index("ix_calls_status_media_checked", "status", "media_checked_at"),
    )
