import asyncio
import logging
import uuid
from contextlib import suppress

import anyio
from pydantic import ValidationError
from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.models import User
from app.schemas.call import CallEvent
from app.schemas.events import RealtimeEvent, event_adapter
from app.schemas.meeting import MeetingEvent
from app.services.calls import may_notify as may_notify_call
from app.services.chat import may_notify
from app.services.chat_outbox import flush_outbox
from app.services.meetings import may_notify as may_notify_meeting

logger = logging.getLogger(__name__)


class ChatHub:
    def __init__(self, settings: Settings, session_factory):
        self.settings = settings
        self.session_factory = session_factory
        self.instance_id = "landconnect-chat-" + uuid.uuid4().hex
        options = dict(decode_responses=True, socket_connect_timeout=1, socket_timeout=2)
        self.publisher = Redis.from_url(settings.redis_url, **options)
        self.subscriber = AsyncRedis.from_url(
            settings.redis_url, client_name=self.instance_id, **options
        )
        self.ready = False
        self._connected = asyncio.Event()
        self._tasks = []
        self.sockets: dict[uuid.UUID, set[asyncio.Queue]] = {}

    async def start(self) -> None:
        self._tasks = [asyncio.create_task(self._listen()), asyncio.create_task(self._relay())]
        with suppress(TimeoutError):
            await asyncio.wait_for(self._connected.wait(), timeout=2)

    async def close(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self.ready = False
        self._disconnect_all()
        await self.subscriber.aclose()
        await anyio.to_thread.run_sync(self.publisher.close)

    def attach(self, user_id: uuid.UUID) -> asyncio.Queue | None:
        channels = self.sockets.setdefault(user_id, set())
        if len(channels) >= 5:
            return None
        queue = asyncio.Queue(maxsize=100)
        channels.add(queue)
        return queue

    def detach(self, user_id: uuid.UUID, queue: asyncio.Queue) -> None:
        channels = self.sockets.get(user_id, set())
        channels.discard(queue)
        if not channels:
            self.sockets.pop(user_id, None)

    @staticmethod
    def _disconnect(queue: asyncio.Queue) -> None:
        while not queue.empty():
            queue.get_nowait()
        queue.put_nowait(None)

    def _disconnect_all(self) -> None:
        for channels in self.sockets.values():
            for queue in channels:
                self._disconnect(queue)

    def _enqueue(self, user_id: uuid.UUID, event: RealtimeEvent) -> None:
        for queue in self.sockets.get(user_id, ()):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._disconnect(queue)

    async def _listen(self) -> None:
        prefix = self.settings.chat_channel_prefix + ":user:"
        while True:
            try:
                async with self.subscriber.pubsub() as pubsub:
                    await pubsub.psubscribe(prefix + "*")
                    last_ping = asyncio.get_running_loop().time()
                    while True:
                        message = await pubsub.get_message(timeout=1)
                        if message and message["type"] == "psubscribe":
                            if self.ready:
                                self._disconnect_all()
                            self.ready = True
                            self._connected.set()
                        elif message and message["type"] == "pmessage":
                            try:
                                user_id = uuid.UUID(message["channel"][len(prefix) :])
                                event = event_adapter.validate_json(message["data"])
                            except (ValueError, ValidationError):
                                logger.warning("Ignored a malformed chat broker event")
                            else:
                                self._enqueue(user_id, event)
                        if asyncio.get_running_loop().time() - last_ping > 10:
                            await pubsub.ping()
                            last_ping = asyncio.get_running_loop().time()
            except (RedisError, OSError):
                self.ready = False
                self._connected.clear()
                self._disconnect_all()
                await asyncio.sleep(1)

    async def _relay(self) -> None:
        while True:
            if self.ready:
                try:
                    await anyio.to_thread.run_sync(
                        flush_outbox,
                        self.session_factory,
                        self.publisher,
                        self.settings.chat_channel_prefix,
                    )
                except (RedisError, SQLAlchemyError):
                    logger.warning("Chat outbox publication failed and will retry")
                    await asyncio.sleep(1)
            await asyncio.sleep(0.2)

    def user_exists(self, user_id: uuid.UUID) -> bool:
        with self.session_factory() as db:
            return db.get(User, user_id) is not None

    def authorized_event(self, user_id: uuid.UUID, event: RealtimeEvent) -> bool:
        with self.session_factory() as db:
            if isinstance(event, MeetingEvent):
                return may_notify_meeting(db, user_id, event)
            if isinstance(event, CallEvent):
                return may_notify_call(db, user_id, event)
            return may_notify(db, user_id, event)
