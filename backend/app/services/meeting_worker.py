from datetime import timedelta

from sqlalchemy import select

from app.core.config import get_settings
from app.models import Meeting, MeetingMember
from app.models.common import now
from app.models.enums import MeetingMemberStatus
from app.services.livekit import MediaUnavailable, meeting_room_name
from app.services.meetings import cleanup, finish


def maintain_meetings(factory, rooms) -> None:
    with factory() as db:
        answered = (
            select(MeetingMember.meeting_id)
            .where(
                MeetingMember.meeting_id == Meeting.id,
                MeetingMember.user_id != Meeting.owner_id,
                MeetingMember.status == MeetingMemberStatus.accepted,
            )
            .exists()
        )
        expired = db.scalars(
            select(Meeting)
            .where(
                Meeting.conversation_id.is_not(None),
                Meeting.ended_at.is_(None),
                Meeting.created_at <= now() - timedelta(seconds=get_settings().call_ring_seconds),
                ~answered,
            )
            .order_by(Meeting.created_at)
            .limit(10)
            .with_for_update(of=Meeting, skip_locked=True)
        ).all()
        for meeting in expired:
            finish(db, meeting)
        db.commit()
        pending = db.scalars(
            select(Meeting.id)
            .where(Meeting.retiring_room_name.is_not(None))
            .order_by(Meeting.media_checked_at.asc().nullsfirst(), Meeting.id)
            .limit(5)
        ).all()
        db.commit()
        for meeting_id in pending:
            cleanup(db, db.get(Meeting, meeting_id), rooms)
        active = db.scalars(
            select(Meeting)
            .where(Meeting.ended_at.is_(None), Meeting.room_sid.is_not(None))
            .order_by(Meeting.media_checked_at.asc().nullsfirst(), Meeting.id)
            .limit(10)
            .with_for_update(of=Meeting, skip_locked=True)
            .execution_options(populate_existing=True)
        ).all()
        if not active:
            return
        try:
            live = rooms.list_named([meeting_room_name(meeting) for meeting in active])
        except MediaUnavailable:
            db.rollback()
            return
        for meeting in active:
            meeting.media_checked_at = now()
            room = live.get(meeting_room_name(meeting))
            if room is None or room.sid != meeting.room_sid:
                finish(db, meeting)
                if room is None:
                    meeting.retiring_room_name, meeting.room_closed_at = None, now()
        db.commit()
