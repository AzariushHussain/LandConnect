import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden
from app.models import ConversationKind, Meeting
from app.schemas.meeting import GroupCallCreate, MeetingCreate
from app.services import chat, meetings
from app.services.privacy import lock_users


def start(db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, data: GroupCallCreate):
    conversation = chat.get_conversation(db, conversation_id, actor, write=True)
    if conversation.kind != ConversationKind.group:
        raise Conflict("Use a direct call for this conversation")
    lock_users(db, {member.user_id for member in conversation.members})
    existing = db.scalar(
        select(Meeting).where(Meeting.owner_id == actor, Meeting.client_id == data.client_id)
    )
    if existing:
        if existing.conversation_id != conversation_id or existing.kind != data.kind:
            raise Conflict("This call attempt belongs to another conversation or call type")
        return existing, False
    active = db.scalar(
        select(Meeting)
        .where(Meeting.conversation_id == conversation_id, Meeting.ended_at.is_(None))
        .with_for_update(of=Meeting)
    )
    if active:
        meetings.expire_group_call(db, active, commit=False)
        if active.ended_at is None:
            member = meetings.member_of(active, actor)
            if not member or member.status not in meetings.CURRENT:
                raise Forbidden("You are not invited to this group call")
            if active.kind != data.kind:
                raise Conflict("A different call type is already active in this group")
            return active, False
    people = [m.user_id for m in conversation.members if m.user_id != actor]
    if not people:
        raise Conflict("Add another group member before calling")
    return meetings.create(
        db,
        actor,
        MeetingCreate(
            client_id=data.client_id, title=conversation.name, kind=data.kind, member_ids=people
        ),
        conversation_id=conversation_id,
    )
