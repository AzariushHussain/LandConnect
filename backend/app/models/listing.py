import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import enum_type, now
from app.models.enums import ListingStatus

if TYPE_CHECKING:
    from app.models.listing_image import ListingImage
    from app.models.user import User


class Listing(Base):
    __tablename__ = "listings"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    area_sq_m: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    address: Mapped[str] = mapped_column(String(300))
    city: Mapped[str] = mapped_column(String(100), index=True)
    state: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(2), default="IN")
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal] = mapped_column(Numeric(10, 6))
    status: Mapped[ListingStatus] = mapped_column(
        enum_type(ListingStatus), default=ListingStatus.draft
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    owner: Mapped["User"] = relationship(lazy="joined")
    images: Mapped[list["ListingImage"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ListingImage.created_at"
    )
    __table_args__ = (
        CheckConstraint("price > 0", name="positive_price"),
        CheckConstraint("area_sq_m > 0", name="positive_area"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="latitude"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="longitude"),
        Index("ix_listings_status_created", "status", "created_at"),
    )
