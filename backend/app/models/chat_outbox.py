import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import now


class ChatOutbox(Base):
    __tablename__ = "chat_outbox"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event: Mapped[dict] = mapped_column(JSON)
    recipient_ids: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_chat_outbox_pending", "published_at", "created_at"),)
