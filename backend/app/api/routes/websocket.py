import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

import anyio
import jwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.api.realtime import get_chat
from app.core.security import decode_access_claims
from app.schemas.chat import SocketAuth
from app.services.realtime import ChatHub

router = APIRouter()
HEARTBEAT_SECONDS = 15


@router.websocket("/ws/chat")
async def chat_socket(socket: WebSocket, hub: Annotated[ChatHub, Depends(get_chat)]) -> None:
    origin = socket.headers.get("origin")
    if origin and origin not in hub.settings.cors_origins:
        await socket.close(code=1008)
        return
    await socket.accept()
    queue = None
    user_id = None
    incoming = outgoing = None
    try:
        if not hub.ready:
            await socket.close(code=1013, reason="Realtime unavailable; retry and recover history")
            return
        async with asyncio.timeout(5):
            raw = await socket.receive_text()
        if len(raw.encode()) > 8192:
            await socket.close(code=1009)
            return
        auth = SocketAuth.model_validate_json(raw)
        claims = decode_access_claims(auth.token.get_secret_value())
        user_id = uuid.UUID(claims["sub"])
        expiry = float(claims["exp"])
        if not await anyio.to_thread.run_sync(hub.user_exists, user_id):
            raise jwt.InvalidTokenError("Account unavailable")
        queue = hub.attach(user_id)
        if queue is None:
            await socket.close(code=1013, reason="Too many connections")
            return
        await socket.send_json({"type": "ready", "user_id": str(user_id)})
        incoming = asyncio.create_task(socket.receive_text())
        outgoing = asyncio.create_task(queue.get())
        next_check = asyncio.get_running_loop().time() + HEARTBEAT_SECONDS
        while True:
            remaining = expiry - datetime.now(UTC).timestamp()
            if remaining <= 0:
                await socket.close(code=1008, reason="Token expired")
                return
            done, _ = await asyncio.wait(
                {incoming, outgoing},
                timeout=min(max(0, next_check - asyncio.get_running_loop().time()), remaining),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if datetime.now(UTC).timestamp() >= expiry:
                await socket.close(code=1008, reason="Token expired")
                return
            if incoming in done:
                raw = incoming.result()
                if len(raw.encode()) > 8192:
                    await socket.close(code=1009)
                    return
                if json.loads(raw) != {"type": "pong"}:
                    await socket.close(code=1008, reason="Use REST to send messages")
                    return
                incoming = asyncio.create_task(socket.receive_text())
            if outgoing in done:
                event = outgoing.result()
                if event is None:
                    await socket.close(code=1013, reason="Reconnect and recover history")
                    return
                if await anyio.to_thread.run_sync(hub.authorized_event, user_id, event):
                    await socket.send_json(event.model_dump(mode="json", exclude_none=True))
                outgoing = asyncio.create_task(queue.get())
            if asyncio.get_running_loop().time() >= next_check:
                if not await anyio.to_thread.run_sync(hub.user_exists, user_id):
                    await socket.close(code=1008, reason="Account unavailable")
                    return
                await socket.send_json({"type": "ping"})
                next_check = asyncio.get_running_loop().time() + HEARTBEAT_SECONDS
    except WebSocketDisconnect:
        pass
    except (jwt.InvalidTokenError, ValidationError, ValueError, KeyError, TimeoutError):
        await socket.close(code=1008, reason="Invalid authentication or protocol")
    except SQLAlchemyError:
        await socket.close(code=1013, reason="Temporary database failure")
    finally:
        for task in (incoming, outgoing):
            if task is not None:
                task.cancel()
        await asyncio.gather(
            *(task for task in (incoming, outgoing) if task), return_exceptions=True
        )
        if queue is not None and user_id is not None:
            hub.detach(user_id, queue)
