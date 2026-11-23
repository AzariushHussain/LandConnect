import asyncio
import uuid
from datetime import timedelta

import aiohttp
from livekit import api

from app.core.config import Settings
from app.models import Call, CallKind, Meeting
from app.schemas.call import CallToken


class MediaUnavailable(Exception):
    pass


def room_name(call_id: uuid.UUID) -> str:
    return "call-" + str(call_id)


def meeting_room_name(meeting: Meeting) -> str:
    return f"meeting-{meeting.id}-{meeting.room_version}"


class LiveKitRooms:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def _request(self, method: str, request):
        try:
            async with api.LiveKitAPI(
                url=self.settings.livekit_internal_url,
                api_key=self.settings.livekit_api_key,
                api_secret=self.settings.livekit_api_secret,
                timeout=aiohttp.ClientTimeout(total=3),
                failover=False,
            ) as client:
                return await getattr(client.room, method)(request)
        except api.TwirpError as error:
            if method in ("delete_room", "remove_participant") and (
                error.code == "not_found" or error.status == 404
            ):
                return None
            raise MediaUnavailable from None
        except (aiohttp.ClientError, TimeoutError):
            raise MediaUnavailable from None

    def create(self, call: Call) -> str:
        return self._create_room(room_name(call.id), 2, 60)

    def _create_room(self, name: str, capacity: int, empty_timeout: int) -> str:
        room = asyncio.run(
            self._request(
                "create_room",
                api.CreateRoomRequest(
                    name=name,
                    max_participants=capacity,
                    empty_timeout=empty_timeout,
                    departure_timeout=90,
                ),
            )
        )
        return room.sid

    def close(self, call_id: uuid.UUID) -> None:
        self.close_named(room_name(call_id))

    def close_named(self, name: str) -> None:
        asyncio.run(self._request("delete_room", api.DeleteRoomRequest(room=name)))

    def list_named(self, names: list[str]):
        response = asyncio.run(self._request("list_rooms", api.ListRoomsRequest(names=names)))
        return {room.name: room for room in response.rooms}

    def create_meeting(self, meeting: Meeting) -> str:
        return self._create_room(meeting_room_name(meeting), 50, 300)

    def leave_meeting(self, meeting: Meeting, actor: uuid.UUID) -> None:
        asyncio.run(
            self._request(
                "remove_participant",
                api.RoomParticipantIdentity(room=meeting_room_name(meeting), identity=str(actor)),
            )
        )

    def list(self, ids: list[uuid.UUID]):
        response = asyncio.run(
            self._request("list_rooms", api.ListRoomsRequest(names=[room_name(i) for i in ids]))
        )
        expected = {room_name(i): i for i in ids}
        return {expected[room.name]: room for room in response.rooms if room.name in expected}

    def token(self, call: Call, actor: uuid.UUID) -> CallToken:
        return self._token(room_name(call.id), call.kind, actor)

    def meeting_token(self, meeting: Meeting, actor: uuid.UUID) -> CallToken:
        return self._token(meeting_room_name(meeting), meeting.kind, actor)

    def _token(self, name: str, kind: CallKind, actor: uuid.UUID) -> CallToken:
        sources = ["microphone", "camera"] if kind == CallKind.video else ["microphone"]
        token = (
            api.AccessToken(self.settings.livekit_api_key, self.settings.livekit_api_secret)
            .with_identity(str(actor))
            .with_ttl(timedelta(seconds=self.settings.call_token_seconds))
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=name,
                    room_create=False,
                    room_list=False,
                    room_admin=False,
                    room_record=False,
                    ingress_admin=False,
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=False,
                    can_update_own_metadata=False,
                    can_publish_sources=sources,
                    agent=False,
                    can_manage_agent_session=False,
                    can_subscribe_metrics=False,
                )
            )
            .to_jwt()
        )
        return CallToken(
            url=self.settings.livekit_public_url,
            room=name,
            token=token,
            expires_in=self.settings.call_token_seconds,
        )
