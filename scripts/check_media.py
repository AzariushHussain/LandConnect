"""Verify synthetic audio/video between native clients without touching application data."""

import argparse
import asyncio
import logging
import math
import sys
import uuid
from array import array
from datetime import timedelta
from pathlib import Path

import aiohttp
from livekit import api

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.core.config import Settings, get_settings
from start_lan import lan_address


async def check(settings: Settings, count: int, relay: bool) -> None:
    from livekit import rtc

    rooms = [rtc.Room() for _ in range(count)]
    identities = [str(uuid.uuid4()) for _ in rooms]
    disconnected = [asyncio.Event() for _ in rooms]
    audio_seen, video_seen = set(), set()
    audio_done, video_done = asyncio.Event(), asyncio.Event()
    expected = count * (count - 1)
    streams, tasks, sources, videos = [], [], [], []
    name = "landconnect-network-check-" + uuid.uuid4().hex
    producer = None
    created = False
    phase = "create room"

    async def consume(track, receiver, sender):
        audio = track.kind == rtc.TrackKind.KIND_AUDIO
        stream = (
            rtc.AudioStream(track, capacity=8)
            if audio
            else rtc.VideoStream(track, capacity=2)
        )
        streams.append(stream)
        async for event in stream:
            valid = (
                any(event.frame.data)
                if audio
                else (event.frame.width, event.frame.height) == (160, 120)
            )
            if valid:
                (audio_seen if audio else video_seen).add((receiver, sender))
                if len(audio_seen) == expected:
                    audio_done.set()
                if len(video_seen) == expected:
                    video_done.set()
                return

    def register(room, receiver):
        @room.on("track_subscribed")
        def subscribed(track, _publication, participant):
            if (
                participant.identity in identities
                and participant.identity != identities[receiver]
            ):
                tasks.append(
                    asyncio.create_task(consume(track, receiver, participant.identity))
                )

        @room.on("disconnected")
        def closed(_reason):
            disconnected[receiver].set()

    async with api.LiveKitAPI(
        url=settings.livekit_internal_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        timeout=aiohttp.ClientTimeout(total=5),
        failover=False,
    ) as client:
        try:
            await client.room.create_room(
                api.CreateRoomRequest(
                    name=name,
                    max_participants=count,
                    empty_timeout=30,
                    departure_timeout=5,
                )
            )
            created = True
            phase = "connect WebRTC clients"
            for index, room in enumerate(rooms):
                phase = f"connect WebRTC client {index + 1}/{count}"
                register(room, index)
                token = (
                    api.AccessToken(
                        settings.livekit_api_key, settings.livekit_api_secret
                    )
                    .with_identity(identities[index])
                    .with_ttl(timedelta(seconds=120))
                    .with_grants(
                        api.VideoGrants(
                            room_join=True,
                            room=name,
                            room_create=False,
                            room_admin=False,
                            room_list=False,
                            can_publish=True,
                            can_subscribe=True,
                            can_publish_data=False,
                            can_publish_sources=["microphone", "camera"],
                            can_update_own_metadata=False,
                        )
                    )
                    .to_jwt()
                )
                options = rtc.RoomOptions(
                    connect_timeout=20,
                    rtc_config=rtc.RtcConfiguration(
                        ice_transport_type=rtc.IceTransportType.TRANSPORT_RELAY
                        if relay
                        else rtc.IceTransportType.TRANSPORT_ALL
                    ),
                )
                await asyncio.wait_for(
                    room.connect(settings.livekit_public_url, token, options=options),
                    25,
                )
            phase = "publish synthetic tracks"
            for room in rooms:
                source = rtc.AudioSource(48000, 1)
                sources.append(source)
                await room.local_participant.publish_track(
                    rtc.LocalAudioTrack.create_audio_track("microphone", source),
                    rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
                )
                video = rtc.VideoSource(160, 120)
                videos.append(video)
                await room.local_participant.publish_track(
                    rtc.LocalVideoTrack.create_video_track("camera", video),
                    rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA),
                )

            async def produce():
                frame = rtc.AudioFrame.create(48000, 1, 480)
                frame.data[:] = array(
                    "h",
                    (
                        int(8000 * math.sin(2 * math.pi * 440 * i / 48000))
                        for i in range(480)
                    ),
                )
                for index in range(1800):
                    for source in sources:
                        await source.capture_frame(frame)
                    if index % 4 == 0:
                        for video in videos:
                            video.capture_frame(
                                rtc.VideoFrame(
                                    160,
                                    120,
                                    rtc.VideoBufferType.RGBA,
                                    bytes([50, 190, 90, 255]) * (160 * 120),
                                )
                            )
                    await asyncio.sleep(0.01)

            producer = asyncio.create_task(produce())
            phase = "receive audio and video in every participant direction"
            await asyncio.wait_for(
                asyncio.gather(audio_done.wait(), video_done.wait()), 15
            )
            phase = "close room and disconnect clients"
            await client.room.delete_room(api.DeleteRoomRequest(room=name))
            await asyncio.wait_for(
                asyncio.gather(*(event.wait() for event in disconnected)), 8
            )
        except Exception as error:  # noqa: BLE001 - report SDK failures without leaking token data.
            raise RuntimeError(
                f"Media check failed during: {phase} ({type(error).__name__})"
            ) from None
        finally:
            if producer:
                producer.cancel()
                await asyncio.gather(producer, return_exceptions=True)
            await asyncio.gather(
                *(room.disconnect() for room in rooms), return_exceptions=True
            )
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.gather(
                *(stream.aclose() for stream in streams), return_exceptions=True
            )
            if created:
                try:
                    await client.room.delete_room(api.DeleteRoomRequest(room=name))
                except api.TwirpError as error:
                    if error.code != "not_found" and error.status != 404:
                        raise RuntimeError(
                            "Temporary media room cleanup failed"
                        ) from None
    mode = "relay-only TURN" if relay else "default ICE"
    print(
        f"PASS: {count} clients exchanged audio AND video in all {expected} directions ({mode})."
    )
    print(
        "PASS: room deletion disconnected every client; only the temporary probe room was removed."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, type=lan_address)
    parser.add_argument("--participants", type=int, choices=(2, 3), default=2)
    parser.add_argument(
        "--relay", action="store_true", help="Require TURN relay for every client"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.CRITICAL)
    try:
        settings = get_settings().model_copy(
            update={
                "livekit_internal_url": f"http://{args.host}:7880",
                "livekit_public_url": f"ws://{args.host}:7880",
            }
        )
        asyncio.run(check(settings, args.participants, args.relay))
    except ImportError:
        parser.exit(
            1,
            "Run with uv --with livekit==1.3.0; the RTC SDK is a diagnostic dependency.\n",
        )
    except Exception as error:  # noqa: BLE001 - sanitize the CLI error boundary and exit nonzero.
        # Never print SDK responses, media tokens or secret settings.
        detail = str(error) if type(error) is RuntimeError else type(error).__name__
        parser.exit(
            1, f"{detail}. Check the LAN profile, advertised IP and media ports.\n"
        )


if __name__ == "__main__":
    main()
