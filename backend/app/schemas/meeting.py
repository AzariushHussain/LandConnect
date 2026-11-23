import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.enums import CallKind, MeetingMemberStatus
from app.schemas.user import PublicUser


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    client_id: uuid.UUID
    title: Annotated[str, Field(min_length=1, max_length=150)]
    kind: CallKind = CallKind.video
    member_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=49)]

    @model_validator(mode="after")
    def unique_members(self) -> Self:
        if len(set(self.member_ids)) != len(self.member_ids):
            raise ValueError("Member IDs must be unique")
        return self


class GroupCallCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: uuid.UUID
    kind: CallKind


class MeetingMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user: PublicUser
    status: MeetingMemberStatus
    responded_at: datetime | None


class MeetingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID | None
    conversation_id: uuid.UUID | None
    owner: PublicUser
    title: str
    kind: CallKind
    created_at: datetime
    ended_at: datetime | None
    room_version: int
    room_closed_at: datetime | None
    retiring_room_name: str | None = Field(exclude=True)
    members: list[MeetingMemberResponse]

    @computed_field
    @property
    def media_cleanup_pending(self) -> bool:
        return self.retiring_room_name is not None or (
            self.ended_at is not None and self.room_closed_at is None
        )


class MeetingFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: Annotated[int, Field(ge=1, le=100)] = 20
    offset: Annotated[int, Field(ge=0, le=10000)] = 0
    status: Literal["open", "ended"] | None = None
    invitation: Literal["invited", "accepted"] | None = None


class MeetingPage(BaseModel):
    items: list[MeetingResponse]
    limit: int
    offset: int


class MeetingEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    type: Literal[
        "meeting.invited",
        "meeting.updated",
        "meeting.member_removed",
        "meeting.room_changed",
        "meeting.ended",
    ]
    meeting_id: uuid.UUID
    actor_id: uuid.UUID | None = None
    target_user_id: uuid.UUID | None = None
