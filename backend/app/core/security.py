import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from pwdlib.exceptions import HashVerificationError, UnknownHashError

from app.core.config import get_settings

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "landconnect"
JWT_AUDIENCE = "landconnect-api"
password_hasher = PasswordHash.recommended()
# Unknown accounts still perform Argon2 verification rather than returning immediately.
_dummy_hash = password_hasher.hash("landconnect-dummy-password")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        valid = password_hasher.verify(password, stored_hash or _dummy_hash)
    except (UnknownHashError, HashVerificationError):
        return False
    return bool(stored_hash) and valid


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    settings = get_settings()
    issued_at = datetime.now(UTC)
    expires_in = settings.access_token_minutes * 60
    token = jwt.encode(
        {
            "sub": str(user_id),
            "iat": issued_at,
            "exp": issued_at + timedelta(seconds=expires_in),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "token_use": "access",
        },
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    return token, expires_in


def decode_access_token(token: str) -> uuid.UUID:
    claims = jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=[JWT_ALGORITHM],
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
        options={"require": ["sub", "iat", "exp", "iss", "aud", "token_use"]},
    )
    if claims["token_use"] != "access":
        raise jwt.InvalidTokenError("Invalid token purpose")
    try:
        return uuid.UUID(claims["sub"])
    except ValueError:
        raise jwt.InvalidTokenError("Invalid token subject") from None
