import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile

from app.api.deps import DatabaseSession, OptionalUser, require_roles
from app.models import Listing, Role, User
from app.schemas.listing import (
    ListingCreate,
    ListingFilters,
    ListingImageResponse,
    ListingMap,
    ListingPage,
    ListingResponse,
    ListingUpdate,
    MapFeature,
    MapProperties,
    OwnedListingFilters,
    PointGeometry,
)
from app.services import listings, media

router = APIRouter(prefix="/listings", tags=["Listings"])
ListingManager = Annotated[User, Depends(require_roles(Role.seller, Role.broker))]


def managed_listing(listing_id: uuid.UUID, db: DatabaseSession, user: ListingManager) -> Listing:
    listing = listings.owned_listing(db, listing_id, user.id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing


ManagedListing = Annotated[Listing, Depends(managed_listing)]


def visible_listing(listing_id: uuid.UUID, db: DatabaseSession, viewer: OptionalUser) -> Listing:
    listing = listings.visible_listing(db, listing_id, viewer.id if viewer else None)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing


VisibleListing = Annotated[Listing, Depends(visible_listing)]


@router.get("", response_model=ListingPage)
def community(db: DatabaseSession, filters: Annotated[ListingFilters, Query()]) -> ListingPage:
    rows, total = listings.browse_listings(db, filters)
    return ListingPage(items=rows, total=total, limit=filters.limit, offset=filters.offset)


@router.get("/map", response_model=ListingMap)
def map_listings(db: DatabaseSession, filters: Annotated[ListingFilters, Query()]) -> ListingMap:
    rows, total = listings.browse_listings(db, filters)
    features = [
        MapFeature(
            id=row.id,
            geometry=PointGeometry(coordinates=(float(row.longitude), float(row.latitude))),
            properties=MapProperties(
                title=row.title,
                price=row.price,
                currency=row.currency,
                area_sq_m=row.area_sq_m,
                city=row.city,
            ),
        )
        for row in rows
    ]
    return ListingMap(features=features, total=total, limit=filters.limit, offset=filters.offset)


@router.get("/mine", response_model=ListingPage)
def my_listings(
    db: DatabaseSession,
    user: ListingManager,
    filters: Annotated[OwnedListingFilters, Query()],
    response: Response,
) -> ListingPage:
    response.headers["Cache-Control"] = "no-store"
    rows, total = listings.browse_listings(db, filters, owner_id=user.id, status=filters.status)
    return ListingPage(items=rows, total=total, limit=filters.limit, offset=filters.offset)


@router.post("", response_model=ListingResponse, status_code=201)
def create(data: ListingCreate, db: DatabaseSession, user: ListingManager) -> Listing:
    return listings.create_listing(db, data, user.id)


@router.get("/{listing_id}", response_model=ListingResponse)
def detail(listing: VisibleListing, response: Response) -> Listing:
    response.headers["Cache-Control"] = "no-store"
    return listing


@router.patch("/{listing_id}", response_model=ListingResponse)
def update(data: ListingUpdate, listing: ManagedListing, db: DatabaseSession) -> Listing:
    return listings.update_listing(db, listing, data)


@router.delete("/{listing_id}", status_code=204)
def archive(listing: ManagedListing, db: DatabaseSession) -> Response:
    listings.archive_listing(db, listing)
    return Response(status_code=204)


@router.post("/{listing_id}/images", response_model=ListingImageResponse, status_code=201)
def upload_image(
    listing: ManagedListing,
    db: DatabaseSession,
    file: Annotated[UploadFile, File()],
):
    try:
        return media.add_image(db, listing, file.file)
    except media.ImageTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from None
    except media.InvalidImageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except media.ImageLimitError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except OSError:
        raise HTTPException(status_code=503, detail="Image storage unavailable") from None


@router.get(
    "/{listing_id}/images/{image_id}",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
def download_image(listing: VisibleListing, image_id: uuid.UUID) -> Response:
    image = next((item for item in listing.images if item.id == image_id), None)
    path = media.image_path(image.filename) if image else None
    if path is None:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        content = path.read_bytes()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found") from None
    except OSError:
        raise HTTPException(status_code=503, detail="Image storage unavailable") from None
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{listing_id}/images/{image_id}", status_code=204)
def delete_image(listing: ManagedListing, image_id: uuid.UUID, db: DatabaseSession) -> Response:
    image = next((item for item in listing.images if item.id == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    media.remove_image(db, listing, image)
    return Response(status_code=204)
