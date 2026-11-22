import asyncio
import logging
from datetime import timedelta

import anyio
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.models import Call, CallStatus
from app.models.common import now
from app.services.calls import ACTIVE, close_pending, expire, finish
from app.services.livekit import LiveKitRooms, MediaUnavailable
from app.services.meeting_worker import maintain_meetings

logger = logging.getLogger(__name__)
JOIN_GRACE_SECONDS = 45


def maintain_calls(factory, rooms: LiveKitRooms) -> None:
    with factory() as db:
        pending = db.scalars(
            select(Call)
            .where(Call.status == CallStatus.ringing, Call.expires_at <= now())
            .order_by(Call.id)
            .limit(50)
            .with_for_update(of=Call, skip_locked=True)
        ).all()
        for call in pending:
            expire(db, call)
        db.commit()
        active = db.scalars(
            select(Call)
            .where(
                Call.status == CallStatus.accepted,
                Call.accepted_at <= now() - timedelta(seconds=JOIN_GRACE_SECONDS),
            )
            .order_by(Call.media_checked_at.asc().nullsfirst(), Call.id)
            .limit(10)
            .with_for_update(of=Call, skip_locked=True)
            .execution_options(populate_existing=True)
        ).all()
        if active:
            try:
                live = rooms.list([call.id for call in active])
            except MediaUnavailable:
                db.rollback()
            else:
                for call in active:
                    room = live.get(call.id)
                    call.media_checked_at = now()
                    if room is None or room.sid != call.room_sid or room.num_participants < 2:
                        finish(db, call, CallStatus.ended)
                        if room is None:
                            call.room_closed_at = now()
                db.commit()
        pending_ids = db.scalars(
            select(Call.id)
            .where(Call.status.not_in(ACTIVE), Call.room_closed_at.is_(None))
            .order_by(Call.ended_at, Call.id)
            .limit(10)
        ).all()
        db.commit()
        for call_id in pending_ids:
            call = db.get(Call, call_id)
            close_pending(db, call, rooms)


class CallWorker:
    def __init__(self, session_factory, rooms: LiveKitRooms):
        self.session_factory = session_factory
        self.rooms = rooms
        self.task = None

    async def start(self) -> None:
        self.task = asyncio.create_task(self._run())

    async def close(self) -> None:
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    async def _run(self) -> None:
        while True:
            try:
                await anyio.to_thread.run_sync(maintain_calls, self.session_factory, self.rooms)
                await anyio.to_thread.run_sync(maintain_meetings, self.session_factory, self.rooms)
            except SQLAlchemyError:
                logger.warning("Call maintenance failed and will retry")
            await asyncio.sleep(1)
