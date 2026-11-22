import argparse
import runpy
import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def lan(tmp_path):
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    script = script_dir / "start_lan.py"
    shutil.copyfile(Path(__file__).resolve().parents[3] / "scripts/start_lan.py", script)
    (tmp_path / ".env").write_text("API_PORT=8000\nTEST_SECRET=preserve-me\n")
    return runpy.run_path(str(script))


@pytest.mark.parametrize(
    "value",
    ["127.0.0.1", "0.0.0.0", "8.8.8.8", "169.254.1.2", "::1", "example.com", "192.168.1.999"],
)
def test_lan_profile_refuses_loopback_public_and_invalid_addresses(lan, value):
    with pytest.raises(argparse.ArgumentTypeError):
        lan["lan_address"](value)


def test_lan_preflight_rejects_unassigned_address_before_changing_containers(lan, monkeypatch):
    probe = MagicMock()
    probe.__enter__.return_value = probe
    probe.bind.side_effect = OSError("not assigned")
    runner = MagicMock()
    monkeypatch.setattr(lan["socket"], "socket", lambda *args: probe)
    monkeypatch.setattr(lan["subprocess"], "run", runner)
    with pytest.raises(OSError):
        lan["start"]("192.168.99.99")
    runner.assert_not_called()


def test_lan_start_uses_private_overlay_and_preserves_environment_file(lan, monkeypatch):
    root = Path(lan["__file__"]).resolve().parents[1]
    before = (root / ".env").read_bytes()
    probe = MagicMock()
    probe.__enter__.return_value = probe
    runner = MagicMock()
    monkeypatch.setattr(lan["socket"], "socket", lambda *args: probe)
    monkeypatch.setattr(lan["subprocess"], "run", runner)
    monkeypatch.delenv("LANDCONNECT_LAN_IP", raising=False)
    lan["start"]("192.168.1.50")
    assert runner.call_count == 2
    for call in runner.call_args_list:
        assert str(root / "compose.lan.yaml") in call.args[0]
        assert call.kwargs["env"]["LANDCONNECT_LAN_IP"] == "192.168.1.50"
    assert "--quiet" in runner.call_args_list[0].args[0]
    assert "--wait" in runner.call_args_list[1].args[0]
    assert (root / ".env").read_bytes() == before
