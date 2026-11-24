import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import CurrentUser, DatabaseSession
from app.api.media import Rooms
from app.models import Call
from app.schemas.call import CallCreate, CallFilters, CallPage, CallResponse, CallToken
from app.schemas.call_history import HistoryFilters, HistoryPage
from app.services import calls
from app.services.call_history import history as call_history

router = APIRouter(prefix="/calls", tags=["Calls"])


@router.post("", response_model=CallResponse, status_code=201)
def create(
    data: CallCreate, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Call:
    call, created = calls.create(db, user.id, data, rooms.settings)
    response.status_code = 201 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return call


@router.get("", response_model=CallPage)
def history(
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[CallFilters, Query()],
    response: Response,
) -> CallPage:
    response.headers["Cache-Control"] = "no-store"
    return CallPage(
        items=calls.list_calls(db, user.id, filters), limit=filters.limit, offset=filters.offset
    )


@router.get("/history", response_model=HistoryPage)
def recent(
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[HistoryFilters, Query()],
    response: Response,
) -> HistoryPage:
    response.headers["Cache-Control"] = "no-store"
    return call_history(db, user.id, filters)


@router.get("/{call_id}", response_model=CallResponse)
def detail(call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, response: Response) -> Call:
    response.headers["Cache-Control"] = "no-store"
    return calls.detail(db, call_id, user.id)


@router.post("/{call_id}/accept", response_model=CallResponse)
def accept(
    call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Call:
    response.headers["Cache-Control"] = "no-store"
    return calls.transition(db, call_id, user.id, "accept", rooms)


@router.post("/{call_id}/reject", response_model=CallResponse)
def reject(
    call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Call:
    response.headers["Cache-Control"] = "no-store"
    return calls.transition(db, call_id, user.id, "reject", rooms)


@router.post("/{call_id}/cancel", response_model=CallResponse)
def cancel(
    call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Call:
    response.headers["Cache-Control"] = "no-store"
    return calls.transition(db, call_id, user.id, "cancel", rooms)


@router.post("/{call_id}/end", response_model=CallResponse)
def end(
    call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Call:
    response.headers["Cache-Control"] = "no-store"
    return calls.transition(db, call_id, user.id, "end", rooms)


@router.post("/{call_id}/token", response_model=CallToken)
def token(
    call_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> CallToken:
    response.headers["Cache-Control"] = "no-store"
    return calls.token(db, call_id, user.id, rooms)
