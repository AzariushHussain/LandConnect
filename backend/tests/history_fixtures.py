from datetime import timedelta
from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.models import (
    Call,
    CallKind,
    CallStatus,
    Conversation,
    ConversationKind,
    ConversationMember,
    Meeting,
    MeetingMember,
    MeetingMemberStatus,
    Role,
    User,
)
from app.models.common import now


def seed_history(engine):
    with Session(engine, expire_on_commit=False) as db:
        users = [
            User(
                email=f"history{i}@example.com",
                display_name=f"Person {i}",
                role=Role.buyer,
                password_hash="unused",
            )
            for i in range(3)
        ]
        db.add_all(users)
        db.flush()
        stamp = now() - timedelta(hours=1)
        group = Conversation(kind=ConversationKind.group, name="Land group", owner_id=users[0].id)
        group.members = [
            ConversationMember(user_id=user.id, role="admin" if i == 0 else "member")
            for i, user in enumerate(users[:2])
        ]
        db.add(group)
        db.flush()
        direct = Call(
            caller_id=users[0].id,
            callee_id=users[1].id,
            kind=CallKind.audio,
            status=CallStatus.ended,
            created_at=stamp - timedelta(minutes=3),
            expires_at=stamp,
            ended_at=stamp,
            room_closed_at=stamp,
        )
        missed = Call(
            caller_id=users[1].id,
            callee_id=users[0].id,
            kind=CallKind.video,
            status=CallStatus.missed,
            created_at=stamp - timedelta(minutes=1),
            expires_at=stamp,
            ended_at=stamp,
            room_closed_at=stamp,
        )
        unrelated = Call(
            caller_id=users[1].id,
            callee_id=users[2].id,
            kind=CallKind.audio,
            status=CallStatus.ended,
            created_at=stamp,
            expires_at=stamp,
            ended_at=stamp,
            room_closed_at=stamp,
        )
        meeting = Meeting(
            owner_id=users[0].id,
            conversation_id=group.id,
            title="Land group",
            kind=CallKind.video,
            created_at=stamp - timedelta(minutes=2),
            ended_at=stamp,
            room_closed_at=stamp,
        )
        formal = Meeting(
            owner_id=users[0].id,
            title="Formal meeting",
            kind=CallKind.video,
            created_at=stamp,
            ended_at=stamp,
            room_closed_at=stamp,
        )
        for item in (meeting, formal):
            item.members = [
                MeetingMember(user_id=user.id, status=MeetingMemberStatus.accepted)
                for user in users[:2]
            ]
        db.add_all([direct, missed, unrelated, meeting, formal])
        db.commit()
        return SimpleNamespace(
            users=[user.id for user in users],
            direct=direct.id,
            missed=missed.id,
            group=group.id,
            group_call=meeting.id,
            formal=formal.id,
            unrelated=unrelated.id,
        )
