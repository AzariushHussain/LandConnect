import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import Conflict, Forbidden, InvalidRequest, NotFound, Unavailable
from app.models import Call, CallStatus, ChatOutbox, User
from app.models.common import now
from app.schemas.call import CallCreate, CallEvent, CallFilters
from app.services.livekit import LiveKitRooms, MediaUnavailable
from app.services.privacy import any_blocked, lock_users

ACTIVE = (CallStatus.ringing, CallStatus.accepted)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def emit(db: Session, call: Call, actor: uuid.UUID | None = None) -> None:
    event = CallEvent(
        event_id=uuid.uuid4(),
        type="call.incoming" if call.status == CallStatus.ringing else "call." + call.status.value,
        call_id=call.id,
        actor_id=actor,
    )
    db.add(
        ChatOutbox(
            id=event.event_id,
            event=event.model_dump(mode="json", exclude_none=True),
            recipient_ids=sorted([str(call.caller_id), str(call.callee_id)]),
        )
    )


def finish(db: Session, call: Call, status: CallStatus, actor: uuid.UUID | None = None) -> None:
    needs_cleanup = call.status == CallStatus.accepted
    call.status = status
    call.ended_at = now()
    if not needs_cleanup:
        call.room_closed_at = call.ended_at
    emit(db, call, actor)


def expire(db: Session, call: Call) -> bool:
    if call.status == CallStatus.ringing and aware(call.expires_at) <= now():
        finish(db, call, CallStatus.missed)
        return True
    return False


def allowed(db: Session, call: Call, people) -> bool:
    return people[call.callee_id].allow_calls and not any_blocked(db, set(people))


def locked(db: Session, call_id: uuid.UUID, actor: uuid.UUID) -> Call:
    call = db.scalar(
        select(Call).where(
            Call.id == call_id, or_(Call.caller_id == actor, Call.callee_id == actor)
        )
    )
    if call is None:
        raise NotFound("Call not found")
    # User locks always precede call locks, including privacy changes and busy checks.
    lock_users(db, {call.caller_id, call.callee_id})
    return db.scalar(
        select(Call)
        .where(Call.id == call_id)
        .with_for_update(of=Call)
        .execution_options(populate_existing=True)
    )


def create(db: Session, actor: uuid.UUID, data: CallCreate, settings: Settings):
    if actor == data.callee_id:
        raise InvalidRequest("Choose another account")
    people = lock_users(db, {actor, data.callee_id})
    existing = db.scalar(
        select(Call)
        .where(Call.caller_id == actor, Call.client_id == data.client_id)
        .with_for_update(of=Call)
        .execution_options(populate_existing=True)
    )
    if existing:
        if existing.callee_id != data.callee_id or existing.kind != data.kind:
            raise Conflict("This client_id already belongs to a different call")
        expire(db, existing)
        db.commit()
        return existing, False
    call = Call(
        id=uuid.uuid4(),
        caller_id=actor,
        callee_id=data.callee_id,
        client_id=data.client_id,
        kind=data.kind,
        status=CallStatus.ringing,
        expires_at=now() + timedelta(seconds=settings.call_ring_seconds),
    )
    if not allowed(db, call, people):
        raise Forbidden("Calling not permitted")
    active = db.scalars(
        select(Call)
        .where(Call.status.in_(ACTIVE), or_(Call.caller_id.in_(people), Call.callee_id.in_(people)))
        .order_by(Call.id)
        .with_for_update(of=Call)
        .execution_options(populate_existing=True)
    ).all()
    for item in active:
        expire(db, item)
    if any(item.status in ACTIVE for item in active):
        db.commit()  # Preserve any timeouts discovered while checking busy participants.
        raise Conflict("A participant already has an active call")
    db.add(call)
    db.flush()
    emit(db, call, actor)
    db.commit()
    db.refresh(call)
    return call, True


def detail(db: Session, call_id: uuid.UUID, actor: uuid.UUID) -> Call:
    call = locked(db, call_id, actor)
    expire(db, call)
    db.commit()
    return call


def list_calls(db: Session, actor: uuid.UUID, filters: CallFilters) -> list[Call]:
    query = select(Call).where(or_(Call.caller_id == actor, Call.callee_id == actor))
    if filters.direction:
        query = query.where(
            (Call.callee_id if filters.direction == "incoming" else Call.caller_id) == actor
        )
    if filters.status:
        query = query.where(Call.status == filters.status)
    return list(
        db.scalars(
            query.order_by(Call.created_at.desc(), Call.id.desc())
            .limit(filters.limit)
            .offset(filters.offset)
        ).all()
    )


def transition(
    db: Session, call_id: uuid.UUID, actor: uuid.UUID, action: str, rooms: LiveKitRooms
) -> Call:
    call = locked(db, call_id, actor)
    if action in ("accept", "reject") and actor != call.callee_id:
        raise Forbidden("Only the callee can perform this action")
    if action == "cancel" and actor != call.caller_id:
        raise Forbidden("Only the caller can cancel")
    if expire(db, call):
        db.commit()
    target = {
        "accept": CallStatus.accepted,
        "reject": CallStatus.rejected,
        "cancel": CallStatus.cancelled,
        "end": CallStatus.ended,
    }[action]
    if call.status == target:
        db.commit()
        if target == CallStatus.ended:
            close_pending(db, call, rooms)
        return call
    required = CallStatus.accepted if action == "end" else CallStatus.ringing
    if call.status != required:
        raise Conflict("Call state does not permit this action")
    if action == "accept":
        people = lock_users(db, {call.caller_id, call.callee_id})
        if not allowed(db, call, people):
            finish(db, call, CallStatus.cancelled, actor)
            db.commit()
            raise Forbidden("Calling not permitted")
        try:
            call.room_sid = rooms.create(call)
        except MediaUnavailable:
            raise Unavailable("Media service unavailable; retry before the call expires") from None
        # Creating a room can take time; never accept after the ringing deadline.
        if expire(db, call):
            call.room_closed_at = None
            db.commit()
            close_pending(db, call, rooms)
            raise Conflict("Call has expired")
        call.status = CallStatus.accepted
        call.accepted_at = now()
        emit(db, call, actor)
    else:
        finish(db, call, target, actor)
    db.commit()
    if target == CallStatus.ended:
        close_pending(db, call, rooms)
    db.refresh(call)
    return call


def token(db: Session, call_id: uuid.UUID, actor: uuid.UUID, rooms: LiveKitRooms):
    call = locked(db, call_id, actor)
    if expire(db, call):
        db.commit()
    if call.status != CallStatus.accepted:
        raise Conflict("Only accepted calls can receive room tokens")
    people = lock_users(db, {call.caller_id, call.callee_id})
    if not allowed(db, call, people):
        finish(db, call, CallStatus.ended, actor)
        db.commit()
        close_pending(db, call, rooms)
        raise Forbidden("Calling not permitted")
    # Room existence is checked without recreating it: old tokens must not revive ended rooms.
    try:
        live = rooms.list([call.id])
    except MediaUnavailable:
        raise Unavailable("Media service unavailable") from None
    room = live.get(call.id)
    if room is None or room.sid != call.room_sid:
        finish(db, call, CallStatus.ended)
        if room is None:
            call.room_closed_at = now()
        db.commit()
        close_pending(db, call, rooms)
        raise Conflict("Media room has closed")
    result = rooms.token(call, actor)
    db.commit()
    return result


def close_pending(db: Session, call: Call, rooms: LiveKitRooms) -> None:
    call = db.scalar(
        select(Call)
        .where(Call.id == call.id)
        .with_for_update(of=Call)
        .execution_options(populate_existing=True)
    )
    if call.status not in ACTIVE and call.room_closed_at is None:
        try:
            rooms.close(call.id)
        except MediaUnavailable:
            db.rollback()
            return
        call.room_closed_at = now()
    db.commit()


def terminate_for_privacy(db: Session, actor: uuid.UUID, target: uuid.UUID | None = None) -> None:
    query = select(Call).where(Call.status.in_(ACTIVE))
    if target:
        query = query.where(
            Call.caller_id.in_({actor, target}), Call.callee_id.in_({actor, target})
        )
    else:
        query = query.where(Call.callee_id == actor)
    for call in db.scalars(query.order_by(Call.id).with_for_update(of=Call)).all():
        finish(
            db,
            call,
            CallStatus.ended if call.status == CallStatus.accepted else CallStatus.cancelled,
            actor,
        )


def may_notify(db: Session, user_id: uuid.UUID, event: CallEvent) -> bool:
    call = db.get(Call, event.call_id)
    if (
        call is None
        or user_id not in (call.caller_id, call.callee_id)
        or db.get(User, user_id) is None
    ):
        return False
    if event.type in ("call.incoming", "call.accepted"):
        if (
            event.type == "call.incoming"
            and (call.status != CallStatus.ringing or aware(call.expires_at) <= now())
        ) or (event.type == "call.accepted" and call.status != CallStatus.accepted):
            return False
        return call.callee.allow_calls and not any_blocked(db, {call.caller_id, call.callee_id})
    return True
