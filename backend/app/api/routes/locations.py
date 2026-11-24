from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.deps import require_roles
from app.core.config import get_settings
from app.models import Role, User
from app.schemas.location import LocationAddress, LocationPoint, PlaceQuery, PlaceResults
from app.services.places import PlaceSearch, SearchBusy

router = APIRouter(prefix="/locations", tags=["Locations"])
LocationManager = Annotated[User, Depends(require_roles(Role.seller, Role.broker))]


def place_search(request: Request) -> PlaceSearch:
    return PlaceSearch(get_settings(), request.app.state.chat.publisher)


@router.post("/search", response_model=PlaceResults)
def search_locations(
    query: PlaceQuery,
    user: LocationManager,
    service: Annotated[PlaceSearch, Depends(place_search)],
    response: Response,
) -> PlaceResults:
    response.headers["Cache-Control"] = "no-store"
    try:
        return service.search(query)
    except SearchBusy:
        raise HTTPException(
            429, "Please wait before searching again.", headers={"Retry-After": "1"}
        )


@router.post("/reverse", response_model=LocationAddress, response_model_exclude_none=True)
def reverse_location(
    point: LocationPoint,
    user: LocationManager,
    service: Annotated[PlaceSearch, Depends(place_search)],
    response: Response,
) -> LocationAddress:
    response.headers["Cache-Control"] = "no-store"
    try:
        return service.reverse(point)
    except SearchBusy:
        raise HTTPException(
            429, "Please wait before looking up the address again.", headers={"Retry-After": "1"}
        )
