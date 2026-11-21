import runpy
import shutil
from pathlib import Path

import pytest
from dotenv import dotenv_values
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    "overrides",
    [
        {"jwt_secret": "too-short"},
        {"livekit_api_secret": "too-short"},
        {"access_token_minutes": 0},
        {"access_token_minutes": 1441},
    ],
)
def test_settings_reject_invalid_security_configuration(overrides):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)


def test_environment_setup_generates_matching_credentials_and_preserves_existing_file(tmp_path):
    root = Path(__file__).resolve().parents[3]
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    script = script_dir / "init_env.py"
    shutil.copyfile(root / "scripts" / "init_env.py", script)
    shutil.copyfile(root / ".env.example", tmp_path / ".env.example")
    runpy.run_path(str(script), run_name="__main__")
    original = (tmp_path / ".env").read_bytes()
    values = dotenv_values(tmp_path / ".env")
    password = values["POSTGRES_PASSWORD"]
    assert password != "local-development-password"
    assert len(password) >= 32
    assert f":{password}@" in values["DATABASE_URL"]
    assert f":{password}@" in values["DOCKER_DATABASE_URL"]
    assert len(values["JWT_SECRET"]) == 64
    assert len(values["LIVEKIT_API_SECRET"]) == 64
    runpy.run_path(str(script), run_name="__main__")
    assert (tmp_path / ".env").read_bytes() == original
