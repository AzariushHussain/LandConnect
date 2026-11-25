import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictBool, model_validator

from app.models.enums import ConversationKind, MemberRole
from app.schemas.user import PublicUser


class DirectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_id: uuid.UUID


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Annotated[str, Field(min_length=1, max_length=100)]
    member_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=49)]

    @model_validator(mode="after")
    def unique_members(self) -> Self:
        if len(set(self.member_ids)) != len(self.member_ids):
            raise ValueError("Member IDs must be unique")
        return self


class GroupRename(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Annotated[str, Field(min_length=1, max_length=100)]


class MemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: uuid.UUID


class MemberUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: MemberRole


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user: PublicUser
    role: MemberRole
    joined_at: datetime


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: ConversationKind
    name: str | None
    owner_id: uuid.UUID | None
    created_at: datetime
    members: list[MemberResponse]


class ConversationPage(BaseModel):
    items: list[ConversationResponse]
    limit: int
    offset: int


class PageFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: Annotated[int, Field(ge=1, le=100)] = 20
    offset: Annotated[int, Field(ge=0, le=10000)] = 0


class BlockPage(BaseModel):
    items: list[PublicUser]
    limit: int
    offset: int


class BlockStatus(BaseModel):
    user_id: uuid.UUID
    blocked: bool


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: uuid.UUID
    body: Annotated[str, Field(min_length=1, max_length=4000)]

    @model_validator(mode="after")
    def nonblank(self) -> Self:
        if not self.body.strip():
            raise ValueError("Message cannot be blank")
        return self


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    conversation_id: uuid.UUID
    sender: PublicUser
    client_id: uuid.UUID | None
    body: str
    created_at: datetime


class HistoryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    after_id: Annotated[int | None, Field(ge=0, le=2147483647)] = None
    before_id: Annotated[int | None, Field(ge=1, le=2147483647)] = None
    limit: Annotated[int, Field(ge=1, le=100)] = 50

    @model_validator(mode="after")
    def one_cursor(self) -> Self:
        if self.after_id is not None and self.before_id is not None:
            raise ValueError("Use after_id or before_id, not both")
        return self


class MessagePage(BaseModel):
    items: list[MessageResponse]
    has_more: bool
    next_after_id: int | None
    next_before_id: int | None


class PrivacyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allow_messages: StrictBool | None = None
    allow_calls: StrictBool | None = None

    @model_validator(mode="after")
    def non_null_changes(self) -> Self:
        if not self.model_fields_set or any(
            getattr(self, key) is None for key in self.model_fields_set
        ):
            raise ValueError("Provide at least one non-null privacy preference")
        return self


class SocketAuth(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["auth"]
    token: SecretStr = Field(min_length=1, max_length=4096)


class ChatEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    type: Literal["message.created", "conversation.updated", "membership.removed"]
    conversation_id: uuid.UUID
    actor_id: uuid.UUID
    message_id: int | None = None
    target_user_id: uuid.UUID | None = None
