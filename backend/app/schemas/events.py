from typing import Annotated

from pydantic import Field, TypeAdapter

from app.schemas.call import CallEvent
from app.schemas.chat import ChatEvent
from app.schemas.meeting import MeetingEvent

RealtimeEvent = Annotated[ChatEvent | CallEvent | MeetingEvent, Field(discriminator="type")]
event_adapter = TypeAdapter(RealtimeEvent)
