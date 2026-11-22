import asyncio
import runpy
import struct
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def checker():
    return runpy.run_path(str(Path(__file__).resolve().parents[3] / "scripts/check_livekit.py"))


def test_check_removes_only_its_temporary_room_on_control_api_failure(checker, monkeypatch):
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.room.list_rooms = AsyncMock(
        side_effect=[SimpleNamespace(rooms=[]), RuntimeError("fail")]
    )

    async def create(request):
        return SimpleNamespace(name=request.name)

    client.room.create_room = AsyncMock(side_effect=create)
    client.room.delete_room = AsyncMock()
    monkeypatch.setattr(checker["api"], "LiveKitAPI", lambda **kwargs: client)
    with pytest.raises(RuntimeError, match="fail"):
        asyncio.run(checker["check"](checker["get_settings"]()))
    name = client.room.create_room.call_args.args[0].name
    assert name.startswith("landconnect-check-")
    client.room.delete_room.assert_awaited_once()
    assert client.room.delete_room.call_args.args[0].room == name


@pytest.mark.parametrize("wrong_transaction", [False, True])
def test_stun_checks_transaction_identity(checker, monkeypatch, wrong_transaction):
    probe = MagicMock()
    probe.__enter__.return_value = probe

    def receive(size):
        request = probe.send.call_args.args[0]
        transaction = b"x" * 12 if wrong_transaction else request[8:20]
        return struct.pack("!HHI12s", 0x0101, 0, 0x2112A442, transaction)

    probe.recv.side_effect = receive
    monkeypatch.setattr(checker["socket"], "socket", lambda *args: probe)
    if wrong_transaction:
        with pytest.raises(RuntimeError, match="Unexpected STUN response"):
            checker["check_stun"]("127.0.0.1")
    else:
        checker["check_stun"]("127.0.0.1")
