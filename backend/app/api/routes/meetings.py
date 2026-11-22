import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import CurrentUser, DatabaseSession
from app.api.media import Rooms
from app.models import Meeting
from app.schemas.call import CallToken
from app.schemas.chat import MemberAdd
from app.schemas.meeting import MeetingCreate, MeetingFilters, MeetingPage, MeetingResponse
from app.services import meetings

router = APIRouter(prefix="/meetings", tags=["Meetings"])


@router.post("", response_model=MeetingResponse, status_code=201)
def create(
    data: MeetingCreate, user: CurrentUser, db: DatabaseSession, response: Response
) -> Meeting:
    meeting, created = meetings.create(db, user.id, data)
    response.status_code = 201 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return meeting


@router.get("", response_model=MeetingPage)
def listing(
    user: CurrentUser,
    db: DatabaseSession,
    filters: Annotated[MeetingFilters, Query()],
    response: Response,
) -> MeetingPage:
    response.headers["Cache-Control"] = "no-store"
    return MeetingPage(
        items=meetings.list_meetings(db, user.id, filters),
        limit=filters.limit,
        offset=filters.offset,
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
def detail(
    meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, response: Response
) -> Meeting:
    response.headers["Cache-Control"] = "no-store"
    return meetings.detail(db, meeting_id, user.id)


@router.post("/{meeting_id}/members", response_model=MeetingResponse)
def invite(
    meeting_id: uuid.UUID,
    data: MemberAdd,
    user: CurrentUser,
    db: DatabaseSession,
    response: Response,
) -> Meeting:
    response.headers["Cache-Control"] = "no-store"
    return meetings.invite(db, meeting_id, user.id, data.user_id)


@router.post("/{meeting_id}/accept", response_model=MeetingResponse)
def accept(
    meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, response: Response
) -> Meeting:
    response.headers["Cache-Control"] = "no-store"
    return meetings.accept(db, meeting_id, user.id)


@router.post(
    "/{meeting_id}/decline",
    status_code=204,
    responses={202: {"description": "Consent withdrawn; media cleanup pending"}},
)
def decline(
    meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms
) -> Response:
    closed = meetings.decline(db, meeting_id, user.id, rooms)
    return Response(status_code=204 if closed else 202, headers={"Cache-Control": "no-store"})


@router.delete(
    "/{meeting_id}/members/{user_id}",
    status_code=204,
    responses={202: {"description": "Access revoked; media cleanup pending"}},
)
def remove(
    meeting_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms
) -> Response:
    closed = meetings.remove(db, meeting_id, user.id, user_id, rooms)
    return Response(status_code=204 if closed else 202, headers={"Cache-Control": "no-store"})


@router.post("/{meeting_id}/token", response_model=CallToken)
def token(
    meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> CallToken:
    response.headers["Cache-Control"] = "no-store"
    return meetings.token(db, meeting_id, user.id, rooms)


@router.post("/{meeting_id}/leave", status_code=204)
def leave(meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms) -> Response:
    meetings.leave(db, meeting_id, user.id, rooms)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/{meeting_id}/end", response_model=MeetingResponse)
def end(
    meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseSession, rooms: Rooms, response: Response
) -> Meeting:
    response.headers["Cache-Control"] = "no-store"
    return meetings.end(db, meeting_id, user.id, rooms)
