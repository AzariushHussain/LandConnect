from typing import Annotated

from fastapi import Depends, Request

from app.services.livekit import LiveKitRooms


def get_rooms(request: Request) -> LiveKitRooms:
    return request.app.state.calls.rooms


Rooms = Annotated[LiveKitRooms, Depends(get_rooms)]
