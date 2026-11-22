"""Verify the local SFU's authenticated control API and STUN listener, without agents."""

import argparse
import asyncio
import secrets
import socket
import struct
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from livekit import api
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.core.config import Settings, get_settings
from start_lan import lan_address


def check_stun(host: str) -> None:
    transaction = secrets.token_bytes(12)
    request = struct.pack("!HHI12s", 0x0001, 0, 0x2112A442, transaction)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.settimeout(3)
        probe.connect((host, 3478))
        probe.send(request)
        response = probe.recv(2048)
    if len(response) < 20:
        raise RuntimeError("Incomplete STUN response")
    kind, size, cookie, returned_transaction = struct.unpack("!HHI12s", response[:20])
    if (
        kind != 0x0101
        or cookie != 0x2112A442
        or transaction != returned_transaction
        or len(response) != size + 20
    ):
        raise RuntimeError("Unexpected STUN response")


async def check(settings: Settings) -> None:
    options = {
        "url": settings.livekit_internal_url,
        "api_key": settings.livekit_api_key,
        "timeout": aiohttp.ClientTimeout(total=5),
        "failover": False,
    }
    name = "landconnect-check-" + uuid.uuid4().hex
    async with api.LiveKitAPI(
        api_secret=settings.livekit_api_secret, **options
    ) as client:
        await client.room.list_rooms(api.ListRoomsRequest())
        created = False
        try:
            room = await client.room.create_room(
                api.CreateRoomRequest(name=name, empty_timeout=30, max_participants=3)
            )
            created = True
            if room.name != name:
                raise RuntimeError("Unexpected room response")
            rooms = await client.room.list_rooms(api.ListRoomsRequest(names=[name]))
            if [room.name for room in rooms.rooms] != [name]:
                raise RuntimeError("Temporary room unavailable")
        finally:
            if created:
                await client.room.delete_room(api.DeleteRoomRequest(room=name))
        remaining = await client.room.list_rooms(api.ListRoomsRequest(names=[name]))
        if remaining.rooms:
            raise RuntimeError("Temporary room cleanup failed")

    # A valid endpoint with the wrong secret must still reject room administration.
    async with api.LiveKitAPI(api_secret=secrets.token_hex(32), **options) as invalid:
        try:
            await invalid.room.list_rooms(api.ListRoomsRequest())
        except api.TwirpError as error:
            if error.status != 401:
                raise RuntimeError("Unexpected authentication response") from None
        else:
            raise RuntimeError("Invalid credentials were accepted")

    host = urlsplit(settings.livekit_public_url).hostname
    if not host:
        raise RuntimeError("LIVEKIT_PUBLIC_URL has no hostname")
    await asyncio.to_thread(check_stun, host)
    with socket.create_connection((host, 7881), timeout=3):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=lan_address, help="LAN profile IPv4 address")
    args = parser.parse_args()
    try:
        settings = get_settings()
        if args.host:
            settings = settings.model_copy(
                update={
                    "livekit_internal_url": f"http://{args.host}:7880",
                    "livekit_public_url": f"ws://{args.host}:7880",
                }
            )
        asyncio.run(check(settings))
    except (
        aiohttp.ClientError,
        api.TwirpError,
        OSError,
        RuntimeError,
        ValidationError,
        ValueError,
    ):
        print(
            "LiveKit check failed. Check service health, credentials, URLs, UDP 3478 and TCP 7881. "
            "Credentials and server responses are omitted.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    print(
        "PASS: room create/list/delete; invalid credentials rejected; STUN/UDP and RTC/TCP reachable."
    )
    print(
        "Only the temporary check room was removed. Use check_media.py for audio/video and TURN media."
    )


if __name__ == "__main__":
    main()
