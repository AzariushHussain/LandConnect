import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.models import CallKind, CallStatus
from app.schemas.user import PublicUser


class CallCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: uuid.UUID
    callee_id: uuid.UUID
    kind: CallKind


class CallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID | None
    caller: PublicUser
    callee: PublicUser
    kind: CallKind
    status: CallStatus
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    ended_at: datetime | None
    room_closed_at: datetime | None

    @computed_field
    @property
    def media_cleanup_pending(self) -> bool:
        return (
            self.status not in (CallStatus.ringing, CallStatus.accepted)
            and self.room_closed_at is None
        )


class CallFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: Annotated[int, Field(ge=1, le=100)] = 20
    offset: Annotated[int, Field(ge=0, le=10000)] = 0
    status: CallStatus | None = None
    direction: Literal["incoming", "outgoing"] | None = None


class CallPage(BaseModel):
    items: list[CallResponse]
    limit: int
    offset: int


class CallToken(BaseModel):
    url: str
    room: str
    token: str
    expires_in: int


class CallEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    type: Literal[
        "call.incoming",
        "call.accepted",
        "call.rejected",
        "call.cancelled",
        "call.missed",
        "call.ended",
    ]
    call_id: uuid.UUID
    actor_id: uuid.UUID | None = None
