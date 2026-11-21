import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import CurrentUser, DatabaseSession
from app.models import Conversation, Message
from app.schemas.chat import (
    ConversationPage,
    ConversationResponse,
    DirectCreate,
    GroupCreate,
    GroupRename,
    HistoryFilters,
    MemberAdd,
    MemberUpdate,
    MessageCreate,
    MessagePage,
    MessageResponse,
    PageFilters,
)
from app.services import chat

router = APIRouter(prefix="/conversations", tags=["Conversations"])


@router.post("/direct", response_model=ConversationResponse, status_code=201)
def direct(
    data: DirectCreate, user: CurrentUser, db: DatabaseSession, response: Response
) -> Conversation:
    conversation, created = chat.create_direct(db, user.id, data.recipient_id)
    response.status_code = 201 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return conversation


@router.post("/groups", response_model=ConversationResponse, status_code=201)
def group(
    data: GroupCreate, user: CurrentUser, db: DatabaseSession, response: Response
) -> Conversation:
    response.headers["Cache-Control"] = "no-store"
    return chat.create_group(db, user.id, data)


@router.get("", response_model=ConversationPage)
def conversations(
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[PageFilters, Query()],
    response: Response,
) -> ConversationPage:
    response.headers["Cache-Control"] = "no-store"
    return ConversationPage(
        items=chat.list_conversations(db, user.id, filters.limit, filters.offset),
        limit=filters.limit,
        offset=filters.offset,
    )


@router.get("/{conversation_id}", response_model=ConversationResponse)
def detail(
    conversation_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, response: Response
) -> Conversation:
    response.headers["Cache-Control"] = "no-store"
    return chat.get_conversation(db, conversation_id, user.id)


@router.patch("/{conversation_id}", response_model=ConversationResponse)
def rename(
    conversation_id: uuid.UUID, data: GroupRename, user: CurrentUser, db: DatabaseSession
) -> Conversation:
    return chat.rename_group(db, conversation_id, user.id, data.name)


@router.post("/{conversation_id}/members", response_model=ConversationResponse)
def invite(
    conversation_id: uuid.UUID, data: MemberAdd, user: CurrentUser, db: DatabaseSession
) -> Conversation:
    return chat.add_member(db, conversation_id, user.id, data.user_id)


@router.patch("/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
def member_role(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    data: MemberUpdate,
    user: CurrentUser,
    db: DatabaseSession,
) -> Conversation:
    return chat.update_member(db, conversation_id, user.id, user_id, data.role)


@router.post("/{conversation_id}/ownership", response_model=ConversationResponse)
def ownership(
    conversation_id: uuid.UUID, data: MemberAdd, user: CurrentUser, db: DatabaseSession
) -> Conversation:
    return chat.transfer_owner(db, conversation_id, user.id, data.user_id)


@router.delete("/{conversation_id}/members/me", status_code=204)
def leave(conversation_id: uuid.UUID, user: CurrentUser, db: DatabaseSession) -> Response:
    chat.remove_member(db, conversation_id, user.id, user.id)
    return Response(status_code=204)


@router.delete("/{conversation_id}/members/{user_id}", status_code=204)
def remove(
    conversation_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DatabaseSession
) -> Response:
    chat.remove_member(db, conversation_id, user.id, user_id)
    return Response(status_code=204)


@router.post("/{conversation_id}/messages", response_model=MessageResponse, status_code=201)
def send(
    conversation_id: uuid.UUID,
    data: MessageCreate,
    user: CurrentUser,
    db: DatabaseSession,
    response: Response,
) -> Message:
    message, created = chat.send_message(db, conversation_id, user.id, data)
    response.status_code = 201 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return message


@router.get("/{conversation_id}/messages", response_model=MessagePage)
def messages(
    conversation_id: uuid.UUID,
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[HistoryFilters, Query()],
    response: Response,
) -> MessagePage:
    response.headers["Cache-Control"] = "no-store"
    return chat.history(db, conversation_id, user.id, filters)
