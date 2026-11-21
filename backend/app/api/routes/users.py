import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import CurrentUser, DatabaseSession
from app.models.user import User
from app.schemas.chat import BlockPage, PageFilters, PrivacyUpdate
from app.schemas.user import UserResponse
from app.services import chat

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser, response: Response) -> User:
    response.headers["Cache-Control"] = "no-store"
    return user


@router.patch("/me/privacy", response_model=UserResponse)
def privacy(
    data: PrivacyUpdate, user: CurrentUser, db: DatabaseSession, response: Response
) -> User:
    response.headers["Cache-Control"] = "no-store"
    return chat.update_privacy(db, user.id, data)


@router.get("/me/blocks", response_model=BlockPage)
def blocks(
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[PageFilters, Query()],
    response: Response,
) -> BlockPage:
    response.headers["Cache-Control"] = "no-store"
    return BlockPage(
        items=chat.list_blocks(db, user.id, filters.limit, filters.offset),
        limit=filters.limit,
        offset=filters.offset,
    )


@router.put("/me/blocks/{user_id}", status_code=204)
def block(user_id: uuid.UUID, user: CurrentUser, db: DatabaseSession) -> Response:
    chat.block_user(db, user.id, user_id)
    return Response(status_code=204)


@router.delete("/me/blocks/{user_id}", status_code=204)
def unblock(user_id: uuid.UUID, user: CurrentUser, db: DatabaseSession) -> Response:
    chat.unblock_user(db, user.id, user_id)
    return Response(status_code=204)
