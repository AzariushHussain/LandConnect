import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, InvalidRequest, NotFound, Unavailable
from app.models import ChatOutbox, ConversationMember, Meeting, MeetingMember, User
from app.models.common import now
from app.models.enums import MeetingMemberStatus as Status
from app.schemas.meeting import MeetingCreate, MeetingEvent, MeetingFilters
from app.services.calls import aware
from app.services.livekit import LiveKitRooms, MediaUnavailable, meeting_room_name
from app.services.privacy import any_blocked, lock_users

CURRENT = (Status.invited, Status.accepted)


def member_of(meeting: Meeting, actor: uuid.UUID) -> MeetingMember | None:
    return next((member for member in meeting.members if member.user_id == actor), None)


def emit(db: Session, meeting: Meeting, event_type: str, actor=None, target=None) -> None:
    event = MeetingEvent(
        event_id=uuid.uuid4(),
        type=event_type,
        meeting_id=meeting.id,
        actor_id=actor,
        target_user_id=target,
    )
    recipients = {str(member.user_id) for member in meeting.members if member.status in CURRENT}
    if target:
        recipients.add(str(target))
    db.add(
        ChatOutbox(
            id=event.event_id,
            event=event.model_dump(mode="json", exclude_none=True),
            recipient_ids=sorted(recipients),
        )
    )


def locked(
    db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, target=None, *, declined=False
) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    states = (*CURRENT, Status.declined) if declined else CURRENT
    member = member_of(meeting, actor) if meeting else None
    if member is None or member.status not in states:
        raise NotFound("Meeting not found")
    # Lock all user rows needed for this operation before the parent meeting row.
    lock_users(db, {meeting.owner_id, actor} | ({target} if target else set()))
    meeting = db.scalar(
        select(Meeting)
        .where(Meeting.id == meeting_id)
        .with_for_update(of=Meeting)
        .execution_options(populate_existing=True)
    )
    member = member_of(meeting, actor)
    if member is None or member.status not in states:
        raise NotFound("Meeting not found")
    if (
        meeting.conversation_id
        and db.get(ConversationMember, (meeting.conversation_id, actor)) is None
    ):
        raise NotFound("Group call not found")
    return meeting


def require_open(meeting: Meeting) -> None:
    if meeting.ended_at is not None:
        raise Conflict("Meeting has ended")


def require_owner(meeting: Meeting, actor: uuid.UUID) -> None:
    if meeting.owner_id != actor:
        raise Forbidden("Only the meeting owner can perform this action")


def check_invitation(db: Session, ids: set[uuid.UUID], invited: set[uuid.UUID]) -> None:
    if any_blocked(db, ids) or any(not db.get(User, user_id).allow_calls for user_id in invited):
        raise Forbidden("Meeting invitation not permitted")


def create(db: Session, actor: uuid.UUID, data: MeetingCreate, *, conversation_id=None):
    if actor in data.member_ids:
        raise InvalidRequest("The owner is already a member")
    invited = set(data.member_ids)
    lock_users(db, invited | {actor})
    initial = sorted(str(i) for i in invited)
    existing = db.scalar(
        select(Meeting).where(Meeting.owner_id == actor, Meeting.client_id == data.client_id)
    )
    if existing:
        if (
            existing.title,
            existing.kind,
            existing.initial_member_ids,
            existing.conversation_id,
        ) != (
            data.title,
            data.kind,
            initial,
            conversation_id,
        ):
            raise Conflict("This client_id already belongs to a different meeting")
        return existing, False
    check_invitation(db, invited | {actor}, invited)
    meeting = Meeting(
        title=data.title,
        kind=data.kind,
        client_id=data.client_id,
        owner_id=actor,
        initial_member_ids=initial,
        conversation_id=conversation_id,
    )
    meeting.members = [
        MeetingMember(
            user_id=i,
            status=Status.accepted if i == actor else Status.invited,
            responded_at=now() if i == actor else None,
        )
        for i in sorted(invited | {actor})
    ]
    db.add(meeting)
    db.flush()
    emit(db, meeting, "meeting.invited", actor)
    db.commit()
    db.refresh(meeting)
    return meeting, True


def list_meetings(db: Session, actor: uuid.UUID, filters: MeetingFilters) -> list[Meeting]:
    query = (
        select(Meeting)
        .join(MeetingMember)
        .where(MeetingMember.user_id == actor, MeetingMember.status.in_(CURRENT))
    )
    if filters.status:
        query = query.where(
            Meeting.ended_at.is_(None)
            if filters.status == "open"
            else Meeting.ended_at.is_not(None)
        )
    if filters.invitation:
        query = query.where(MeetingMember.status == filters.invitation)
    return list(
        db.scalars(
            query.order_by(Meeting.created_at.desc(), Meeting.id.desc())
            .limit(filters.limit)
            .offset(filters.offset)
        ).all()
    )


def detail(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID) -> Meeting:
    return locked(db, meeting_id, actor)


def invite(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, target: uuid.UUID) -> Meeting:
    meeting = locked(db, meeting_id, actor, target)
    require_open(meeting)
    require_owner(meeting, actor)
    if meeting.conversation_id:
        raise Forbidden("Group calls use the conversation member list")
    member = member_of(meeting, target)
    if member and member.status in CURRENT:
        return meeting
    current = {m.user_id for m in meeting.members if m.status in CURRENT}
    if len(current) >= 50:
        raise Conflict("A meeting can have at most 50 invited or accepted members")
    check_invitation(db, current | {target}, {target})
    if member:
        member.status, member.responded_at, member.token_issued_at = Status.invited, None, None
    else:
        meeting.members.append(MeetingMember(user_id=target, status=Status.invited))
    emit(db, meeting, "meeting.invited", actor, target)
    db.commit()
    db.refresh(meeting)
    return meeting


def accept(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID) -> Meeting:
    meeting = locked(db, meeting_id, actor)
    expire_group_call(db, meeting)
    require_open(meeting)
    member = member_of(meeting, actor)
    if member.status == Status.accepted:
        return meeting
    check_invitation(db, {m.user_id for m in meeting.members if m.status in CURRENT}, {actor})
    member.status, member.responded_at = Status.accepted, now()
    emit(db, meeting, "meeting.updated", actor, actor)
    db.commit()
    db.refresh(meeting)
    return meeting


def retire(meeting: Meeting) -> None:
    if meeting.room_sid is not None:
        meeting.retiring_room_name = meeting_room_name(meeting)
        meeting.room_sid = None


def revoke(
    db: Session, meeting: Meeting, member: MeetingMember, status: Status, actor: uuid.UUID
) -> None:
    if member.token_issued_at is not None and meeting.room_sid is not None:
        retire(meeting)
        meeting.room_version += 1
        emit(db, meeting, "meeting.room_changed", actor)
    member.status, member.responded_at = status, now()
    emit(db, meeting, "meeting.member_removed", actor, member.user_id)


def cleanup(db: Session, meeting: Meeting, rooms: LiveKitRooms) -> bool:
    meeting = db.scalar(
        select(Meeting)
        .where(Meeting.id == meeting.id)
        .with_for_update(of=Meeting)
        .execution_options(populate_existing=True)
    )
    if meeting.retiring_room_name:
        try:
            rooms.close_named(meeting.retiring_room_name)
        except MediaUnavailable:
            meeting.media_checked_at = now()
            db.commit()
            return False
        meeting.retiring_room_name = None
        if meeting.ended_at is None:
            emit(db, meeting, "meeting.room_changed")
    if meeting.ended_at is not None and meeting.room_closed_at is None:
        meeting.room_closed_at = now()
    db.commit()
    return True


def remove(
    db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, target: uuid.UUID, rooms: LiveKitRooms
) -> bool:
    meeting = locked(db, meeting_id, actor, target)
    require_open(meeting)
    require_owner(meeting, actor)
    if target == meeting.owner_id:
        raise Conflict("The owner must end the meeting instead of removing themselves")
    member = member_of(meeting, target)
    if member is None:
        raise NotFound("Meeting member not found")
    if member.status != Status.removed:
        revoke(db, meeting, member, Status.removed, actor)
    db.commit()
    return cleanup(db, meeting, rooms)


def decline(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, rooms: LiveKitRooms) -> bool:
    meeting = locked(db, meeting_id, actor, declined=True)
    require_open(meeting)
    if actor == meeting.owner_id:
        raise Conflict("The owner must end the meeting")
    member = member_of(meeting, actor)
    if member.status != Status.declined:
        revoke(db, meeting, member, Status.declined, actor)
    db.commit()
    return cleanup(db, meeting, rooms)


def finish(db: Session, meeting: Meeting, actor=None) -> None:
    retire(meeting)
    meeting.ended_at = now()
    if not meeting.retiring_room_name:
        meeting.room_closed_at = now()
    emit(db, meeting, "meeting.ended", actor)


def end(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, rooms: LiveKitRooms) -> Meeting:
    meeting = locked(db, meeting_id, actor)
    require_owner(meeting, actor)
    if meeting.ended_at is None:
        finish(db, meeting, actor)
    db.commit()
    cleanup(db, meeting, rooms)
    db.refresh(meeting)
    return meeting


def token(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, rooms: LiveKitRooms):
    meeting = locked(db, meeting_id, actor)
    expire_group_call(db, meeting)
    require_open(meeting)
    member = member_of(meeting, actor)
    if member.status != Status.accepted:
        raise Forbidden("Accept the invitation before joining")
    check_invitation(
        db,
        {m.user_id for m in meeting.members if m.status in CURRENT},
        {actor} if actor != meeting.owner_id else set(),
    )
    if meeting.retiring_room_name:
        raise Unavailable("Media access is paused while prior room cleanup retries")
    try:
        if meeting.room_sid is None:
            meeting.room_sid = rooms.create_meeting(meeting)
            emit(db, meeting, "meeting.updated", actor)
        else:
            live = rooms.list_named([meeting_room_name(meeting)])
            room = live.get(meeting_room_name(meeting))
            if room is None or room.sid != meeting.room_sid:
                finish(db, meeting)
                if room is None:
                    meeting.retiring_room_name, meeting.room_closed_at = None, now()
                db.commit()
                cleanup(db, meeting, rooms)
                raise Conflict("Media room has closed")
    except MediaUnavailable:
        raise Unavailable("Media service unavailable") from None
    result = rooms.meeting_token(meeting, actor)
    member.token_issued_at = now()
    db.commit()
    return result


def leave(db: Session, meeting_id: uuid.UUID, actor: uuid.UUID, rooms: LiveKitRooms) -> None:
    meeting = locked(db, meeting_id, actor)
    require_open(meeting)
    if member_of(meeting, actor).status != Status.accepted:
        raise Forbidden("Accept the invitation before joining")
    if meeting.room_sid:
        try:
            rooms.leave_meeting(meeting, actor)
        except MediaUnavailable:
            raise Unavailable("Could not disconnect media; disconnect locally and retry") from None
    db.commit()


def revoke_for_privacy(db: Session, actor: uuid.UUID, target=None) -> None:
    own = select(MeetingMember.meeting_id).where(
        MeetingMember.user_id == actor, MeetingMember.status.in_(CURRENT)
    )
    query = select(Meeting).where(Meeting.id.in_(own), Meeting.ended_at.is_(None))
    if target:
        other = select(MeetingMember.meeting_id).where(
            MeetingMember.user_id == target, MeetingMember.status.in_(CURRENT)
        )
        query = query.where(Meeting.id.in_(other))
    else:
        query = query.where(Meeting.owner_id != actor)
    for meeting in db.scalars(
        query.order_by(Meeting.id)
        .with_for_update(of=Meeting)
        .execution_options(populate_existing=True)
    ).all():
        removed = target if target and meeting.owner_id == actor else actor
        revoke(db, meeting, member_of(meeting, removed), Status.removed, actor)


def may_notify(db: Session, actor: uuid.UUID, event: MeetingEvent) -> bool:
    if db.get(User, actor) is None:
        return False
    if event.type == "meeting.member_removed" and event.target_user_id == actor:
        return True
    member = db.get(MeetingMember, (event.meeting_id, actor))
    if member is None or member.status not in CURRENT:
        return False
    meeting = db.get(Meeting, event.meeting_id)
    return (
        meeting is not None
        and (
            not meeting.conversation_id
            or db.get(ConversationMember, (meeting.conversation_id, actor)) is not None
        )
        and (event.type == "meeting.ended" or meeting.ended_at is None)
    )


def unanswered_group_call(meeting: Meeting) -> bool:
    return bool(
        meeting.conversation_id
        and meeting.ended_at is None
        and aware(meeting.created_at) + timedelta(seconds=get_settings().call_ring_seconds) <= now()
        and not any(
            m.status == Status.accepted and m.user_id != meeting.owner_id for m in meeting.members
        )
    )


def expire_group_call(db: Session, meeting: Meeting, *, commit=True) -> None:
    if unanswered_group_call(meeting):
        finish(db, meeting)
        if commit:
            db.commit()


def revoke_group_member(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID, actor: uuid.UUID
) -> None:
    sessions = db.scalars(
        select(Meeting)
        .where(Meeting.conversation_id == conversation_id, Meeting.ended_at.is_(None))
        .with_for_update(of=Meeting)
    ).all()
    for meeting in sessions:
        member = member_of(meeting, user_id)
        if member and member.status in CURRENT:
            if meeting.owner_id == user_id:
                finish(db, meeting, actor)
            else:
                revoke(db, meeting, member, Status.removed, actor)
