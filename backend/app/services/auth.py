from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest


class EmailAlreadyRegisteredError(Exception):
    pass


def register_user(db: Session, data: RegisterRequest) -> User:
    user = User(
        email=data.email,
        password_hash=hash_password(data.password.get_secret_value()),
        display_name=data.display_name,
        role=data.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.scalar(select(User.id).where(User.email == data.email)) is not None:
            raise EmailAlreadyRegisteredError from None
        raise
    db.refresh(user)
    return user


def authenticate_user(db: Session, data: LoginRequest) -> User | None:
    user = db.scalar(select(User).where(User.email == data.email))
    valid = verify_password(data.password.get_secret_value(), user.password_hash if user else None)
    return user if valid else None
