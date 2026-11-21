import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ChatConflict, ChatForbidden, ChatInvalid, ChatNotFound
from app.models import (
    Block,
    ChatOutbox,
    Conversation,
    ConversationKind,
    ConversationMember,
    MemberRole,
    Message,
    User,
)
from app.schemas.chat import (
    ChatEvent,
    GroupCreate,
    HistoryFilters,
    MessageCreate,
    MessagePage,
    PrivacyUpdate,
)

MAX_GROUP_MEMBERS = 50


def lock_users(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    rows = db.scalars(
        select(User)
        .where(User.id.in_(ids))
        .order_by(User.id)
        .with_for_update(of=User)
        .execution_options(populate_existing=True)
    ).all()
    if len(rows) != len(ids):
        raise ChatNotFound("User not found")
    return {row.id: row for row in rows}


def any_blocked(db: Session, ids: set[uuid.UUID]) -> bool:
    return (
        db.scalar(
            select(Block.blocker_id)
            .where(Block.blocker_id.in_(ids), Block.blocked_id.in_(ids))
            .limit(1)
        )
        is not None
    )


def invitation_allowed(db: Session, people: dict[uuid.UUID, User], invited: set[uuid.UUID]) -> None:
    if any(not people[user_id].allow_messages for user_id in invited) or any_blocked(
        db, set(people)
    ):
        raise ChatForbidden("Messaging or invitation not permitted")


def get_conversation(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, *, write=False
) -> Conversation:
    own = select(ConversationMember.conversation_id).where(ConversationMember.user_id == actor)
    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.id.in_(own))
        .with_for_update(read=not write, of=Conversation)
        .execution_options(populate_existing=True)
    )
    if conversation is None:
        raise ChatNotFound("Conversation not found")
    # A removal may have committed while this query waited for the parent lock.
    # Recheck with a fresh READ COMMITTED snapshot while holding that lock.
    if (
        db.scalar(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == actor,
            )
        )
        is None
    ):
        raise ChatNotFound("Conversation not found")
    return conversation


def list_conversations(
    db: Session, actor: uuid.UUID, limit: int, offset: int
) -> list[Conversation]:
    return list(
        db.scalars(
            select(Conversation)
            .join(ConversationMember)
            .where(ConversationMember.user_id == actor)
            .order_by(Conversation.created_at.desc(), Conversation.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
    )


def emit(
    db: Session,
    conversation: Conversation,
    actor: uuid.UUID,
    *,
    event_type="conversation.updated",
    message_id: int | None = None,
    removed: uuid.UUID | None = None,
) -> None:
    event_id = uuid.uuid4()
    event = ChatEvent(
        event_id=event_id,
        type=event_type,
        conversation_id=conversation.id,
        actor_id=actor,
        message_id=message_id,
        target_user_id=removed,
    )
    recipients = {str(member.user_id) for member in conversation.members}
    if removed:
        recipients.add(str(removed))
    db.add(
        ChatOutbox(
            id=event_id,
            event=event.model_dump(mode="json", exclude_none=True),
            recipient_ids=sorted(recipients),
        )
    )


def create_direct(db: Session, actor: uuid.UUID, recipient: uuid.UUID) -> tuple[Conversation, bool]:
    if actor == recipient:
        raise ChatInvalid("Choose another account")
    people = lock_users(db, {actor, recipient})
    invitation_allowed(db, people, {recipient})
    a, b = sorted((actor, recipient))
    existing = db.scalar(
        select(Conversation).where(Conversation.user_a_id == a, Conversation.user_b_id == b)
    )
    if existing:
        return existing, False
    conversation = Conversation(kind=ConversationKind.direct, user_a_id=a, user_b_id=b)
    conversation.members = [ConversationMember(user_id=a), ConversationMember(user_id=b)]
    db.add(conversation)
    db.flush()
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation, True


def create_group(db: Session, actor: uuid.UUID, data: GroupCreate) -> Conversation:
    if actor in data.member_ids:
        raise ChatInvalid("The owner is already a member")
    invited = set(data.member_ids)
    people = lock_users(db, invited | {actor})
    invitation_allowed(db, people, invited)
    conversation = Conversation(kind=ConversationKind.group, name=data.name, owner_id=actor)
    conversation.members = [
        ConversationMember(
            user_id=user_id, role=MemberRole.admin if user_id == actor else MemberRole.member
        )
        for user_id in sorted(people)
    ]
    db.add(conversation)
    db.flush()
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation


def group_admin(conversation: Conversation, actor: uuid.UUID, *, owner_only=False) -> None:
    if conversation.kind != ConversationKind.group:
        raise ChatConflict("Direct conversation participants cannot be changed")
    member = next((m for m in conversation.members if m.user_id == actor), None)
    if conversation.owner_id != actor and (
        owner_only or member is None or member.role != MemberRole.admin
    ):
        raise ChatForbidden("Group permission required")


def rename_group(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, name: str
) -> Conversation:
    conversation = get_conversation(db, conversation_id, actor, write=True)
    group_admin(conversation, actor)
    conversation.name = name
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation


def add_member(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    conversation = get_conversation(db, conversation_id, actor, write=True)
    group_admin(conversation, actor)
    current = {m.user_id for m in conversation.members}
    if user_id in current:
        return conversation
    if len(current) >= MAX_GROUP_MEMBERS:
        raise ChatConflict("A group can have at most 50 members")
    people = lock_users(db, current | {user_id})
    invitation_allowed(db, people, {user_id})
    conversation.members.append(ConversationMember(user_id=user_id))
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation


def update_member(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, user_id: uuid.UUID, role: MemberRole
) -> Conversation:
    conversation = get_conversation(db, conversation_id, actor, write=True)
    group_admin(conversation, actor, owner_only=True)
    if user_id == conversation.owner_id:
        raise ChatConflict("Transfer ownership before changing the owner's role")
    member = next((m for m in conversation.members if m.user_id == user_id), None)
    if member is None:
        raise ChatNotFound("Member not found")
    member.role = role
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation


def transfer_owner(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    conversation = get_conversation(db, conversation_id, actor, write=True)
    group_admin(conversation, actor, owner_only=True)
    member = next((m for m in conversation.members if m.user_id == user_id), None)
    if member is None:
        raise ChatNotFound("Member not found")
    conversation.owner_id = user_id
    member.role = MemberRole.admin
    emit(db, conversation, actor)
    db.commit()
    db.refresh(conversation)
    return conversation


def remove_member(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, user_id: uuid.UUID
) -> None:
    conversation = get_conversation(db, conversation_id, actor, write=True)
    if conversation.kind != ConversationKind.group:
        raise ChatConflict("Direct conversation participants cannot be changed")
    if user_id == conversation.owner_id:
        raise ChatConflict("The owner must transfer ownership before leaving")
    member = next((m for m in conversation.members if m.user_id == user_id), None)
    if member is None:
        raise ChatNotFound("Member not found")
    if actor != user_id:
        group_admin(conversation, actor)
        if member.role == MemberRole.admin and actor != conversation.owner_id:
            raise ChatForbidden("Only the owner can remove an admin")
    conversation.members.remove(member)
    emit(db, conversation, actor, event_type="membership.removed", removed=user_id)
    db.commit()


def send_message(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, data: MessageCreate
) -> tuple[Message, bool]:
    # Serializing conversation writes keeps per-conversation message IDs in commit order.
    conversation = get_conversation(db, conversation_id, actor, write=True)
    existing = db.scalar(
        select(Message).where(
            Message.conversation_id == conversation_id,
            Message.sender_id == actor,
            Message.client_id == data.client_id,
        )
    )
    if existing:
        if existing.body != data.body:
            raise ChatConflict("This client_id already belongs to a different message")
        return existing, False
    if conversation.kind == ConversationKind.direct:
        recipient = (
            conversation.user_b_id if conversation.user_a_id == actor else conversation.user_a_id
        )
        people = lock_users(db, {actor, recipient})
        invitation_allowed(db, people, {recipient})
    message = Message(
        conversation_id=conversation_id, sender_id=actor, client_id=data.client_id, body=data.body
    )
    db.add(message)
    db.flush()
    emit(db, conversation, actor, event_type="message.created", message_id=message.id)
    db.commit()
    db.refresh(message)
    return message, True


def history(
    db: Session, conversation_id: uuid.UUID, actor: uuid.UUID, filters: HistoryFilters
) -> MessagePage:
    get_conversation(db, conversation_id, actor)
    statement = select(Message).where(Message.conversation_id == conversation_id)
    catching_up = filters.after_id is not None
    if catching_up:
        statement = statement.where(Message.id > filters.after_id).order_by(Message.id)
    else:
        if filters.before_id is not None:
            statement = statement.where(Message.id < filters.before_id)
        statement = statement.order_by(Message.id.desc())
    rows = list(db.scalars(statement.limit(filters.limit + 1)).all())
    has_more = len(rows) > filters.limit
    rows = rows[: filters.limit]
    if not catching_up:
        rows.reverse()
    return MessagePage(
        items=rows,
        has_more=has_more,
        next_after_id=rows[-1].id if rows else filters.after_id,
        next_before_id=rows[0].id if rows and has_more and not catching_up else None,
    )


def update_privacy(db: Session, actor: uuid.UUID, data: PrivacyUpdate) -> User:
    user = lock_users(db, {actor})[actor]
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


def block_user(db: Session, actor: uuid.UUID, target: uuid.UUID) -> None:
    if actor == target:
        raise ChatInvalid("You cannot block yourself")
    lock_users(db, {actor, target})
    if db.get(Block, (actor, target)) is None:
        db.add(Block(blocker_id=actor, blocked_id=target))
        db.commit()


def unblock_user(db: Session, actor: uuid.UUID, target: uuid.UUID) -> None:
    lock_users(db, {actor})
    block = db.get(Block, (actor, target))
    if block is not None:
        db.delete(block)
        db.commit()


def list_blocks(db: Session, actor: uuid.UUID, limit: int, offset: int) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .join(Block, Block.blocked_id == User.id)
            .where(Block.blocker_id == actor)
            .order_by(User.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )


def may_notify(db: Session, user_id: uuid.UUID, event: ChatEvent) -> bool:
    if db.get(User, user_id) is None:
        return False
    if event.type == "membership.removed" and event.target_user_id == user_id:
        return True
    member = db.get(ConversationMember, (event.conversation_id, user_id))
    if member is None:
        return False
    conversation = db.get(Conversation, event.conversation_id)
    if (
        event.type == "message.created"
        and conversation.kind == ConversationKind.direct
        and user_id != event.actor_id
    ):
        user = db.get(User, user_id)
        return user.allow_messages and not any_blocked(db, {user_id, event.actor_id})
    return True
