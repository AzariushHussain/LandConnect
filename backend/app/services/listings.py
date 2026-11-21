import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Listing, ListingStatus
from app.schemas.listing import ListingCreate, ListingFilters, ListingUpdate


def browse_listings(
    db: Session,
    filters: ListingFilters,
    *,
    owner_id: uuid.UUID | None = None,
    status: ListingStatus | None = None,
) -> tuple[list[Listing], int]:
    conditions = (
        [Listing.owner_id == owner_id] if owner_id else [Listing.status == ListingStatus.active]
    )
    if status is not None:
        conditions.append(Listing.status == status)
    if filters.q:
        conditions.append(
            or_(
                Listing.title.icontains(filters.q, autoescape=True),
                Listing.description.icontains(filters.q, autoescape=True),
                Listing.city.icontains(filters.q, autoescape=True),
            )
        )
    for name in ("city", "state", "country", "currency"):
        value = getattr(filters, name)
        if value is not None:
            conditions.append(func.lower(getattr(Listing, name)) == value.lower())
    for column, minimum, maximum in (
        (Listing.price, filters.min_price, filters.max_price),
        (Listing.area_sq_m, filters.min_area, filters.max_area),
    ):
        if minimum is not None:
            conditions.append(column >= minimum)
        if maximum is not None:
            conditions.append(column <= maximum)
    if filters.south is not None:
        conditions.append(Listing.latitude.between(filters.south, filters.north))
        if filters.west <= filters.east:
            conditions.append(Listing.longitude.between(filters.west, filters.east))
        else:
            conditions.append(
                or_(Listing.longitude >= filters.west, Listing.longitude <= filters.east)
            )
    total = db.scalar(select(func.count(Listing.id)).where(*conditions))
    # shortcut: use keyset pagination instead if a large, fast-changing feed needs stable cursors.
    rows = db.scalars(
        select(Listing)
        .where(*conditions)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
        .limit(filters.limit)
        .offset(filters.offset)
    ).all()
    return list(rows), total


def visible_listing(
    db: Session, listing_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> Listing | None:
    visibility = Listing.status == ListingStatus.active
    if viewer_id:
        visibility = or_(visibility, Listing.owner_id == viewer_id)
    return db.scalar(select(Listing).where(Listing.id == listing_id, visibility))


def owned_listing(db: Session, listing_id: uuid.UUID, owner_id: uuid.UUID) -> Listing | None:
    return db.scalar(
        select(Listing)
        .where(Listing.id == listing_id, Listing.owner_id == owner_id)
        .with_for_update(of=Listing)
    )


def create_listing(db: Session, data: ListingCreate, owner_id: uuid.UUID) -> Listing:
    listing = Listing(**data.model_dump(), owner_id=owner_id)
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


def update_listing(db: Session, listing: Listing, data: ListingUpdate) -> Listing:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(listing, field, value)
    db.commit()
    db.refresh(listing)
    return listing


def archive_listing(db: Session, listing: Listing) -> None:
    listing.status = ListingStatus.archived
    db.commit()
