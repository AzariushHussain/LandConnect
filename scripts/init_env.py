"""Create local development secrets once, without overwriting existing settings."""

import secrets
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    target = root / ".env"
    values = (root / ".env.example").read_text(encoding="utf-8")
    values = values.replace("local-development-password", secrets.token_hex(24))
    values = values.replace(
        "replace-with-at-least-32-random-characters", secrets.token_hex(32)
    )
    values = values.replace(
        "local-development-livekit-secret-32-characters", secrets.token_hex(32)
    )
    try:
        with target.open("x", encoding="utf-8", newline="\n") as output:
            output.write(values)
    except FileExistsError:
        print("Existing .env preserved. No settings were changed.")
    else:
        print("Created .env with random local secrets. Keep it out of Git.")


if __name__ == "__main__":
    main()
