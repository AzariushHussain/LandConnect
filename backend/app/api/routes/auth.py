from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import DatabaseSession
from app.core.security import create_access_token
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserResponse
from app.services.auth import EmailAlreadyRegisteredError, authenticate_user, register_user

# shortcut: auth has no throttling; add shared rate limits before public deployment.
router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, db: DatabaseSession, response: Response) -> User:
    try:
        user = register_user(db, data)
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=409, detail="Email is already registered") from None
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: DatabaseSession, response: Response) -> TokenResponse:
    user = authenticate_user(db, data)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token, expires_in = create_access_token(user.id)
    response.headers["Cache-Control"] = "no-store"
    return TokenResponse(access_token=token, expires_in=expires_in)
