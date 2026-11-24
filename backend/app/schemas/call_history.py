import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import CallKind, CallStatus
from app.schemas.user import PublicUser


class HistoryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: Annotated[int, Field(ge=1, le=100)] = 20
    offset: Annotated[int, Field(ge=0, le=10000)] = 0
    missed_only: bool = False


class HistoryItem(BaseModel):
    id: uuid.UUID
    source: Literal["direct", "group"]
    title: str
    kind: CallKind
    status: CallStatus | Literal["open"]
    direction: Literal["incoming", "outgoing"]
    created_at: datetime
    conversation_id: uuid.UUID | None
    peer: PublicUser | None


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    limit: int
    offset: int
    has_more: bool
