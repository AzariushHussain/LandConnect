import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.enums import ListingStatus, Role

Amount = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
Latitude = Annotated[Decimal, Field(ge=-90, le=90, max_digits=9, decimal_places=6)]
Longitude = Annotated[Decimal, Field(ge=-180, le=180, max_digits=10, decimal_places=6)]
Title = Annotated[str, Field(min_length=1, max_length=150)]
Description = Annotated[str, Field(min_length=1, max_length=10000)]
Address = Annotated[str, Field(min_length=1, max_length=300)]
Place = Annotated[str, Field(min_length=1, max_length=100)]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Country = Annotated[str, Field(pattern=r"^[A-Z]{2}$")]


class ListingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Title
    description: Description
    price: Amount
    currency: Currency = "INR"
    area_sq_m: Amount
    address: Address
    city: Place
    state: Place
    country: Country = "IN"
    latitude: Latitude
    longitude: Longitude
    status: ListingStatus = ListingStatus.draft


class ListingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Title | None = None
    description: Description | None = None
    price: Amount | None = None
    currency: Currency | None = None
    area_sq_m: Amount | None = None
    address: Address | None = None
    city: Place | None = None
    state: Place | None = None
    country: Country | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    status: ListingStatus | None = None

    @model_validator(mode="after")
    def require_non_null_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one listing field")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Listing fields cannot be null")
        return self


class ListingFilters(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)

    q: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    city: Place | None = None
    state: Place | None = None
    country: Country | None = None
    currency: Currency | None = None
    min_price: Annotated[Decimal | None, Field(ge=0, max_digits=14, decimal_places=2)] = None
    max_price: Annotated[Decimal | None, Field(ge=0, max_digits=14, decimal_places=2)] = None
    min_area: Annotated[Decimal | None, Field(ge=0, max_digits=14, decimal_places=2)] = None
    max_area: Annotated[Decimal | None, Field(ge=0, max_digits=14, decimal_places=2)] = None
    south: Annotated[float | None, Field(ge=-90, le=90)] = None
    north: Annotated[float | None, Field(ge=-90, le=90)] = None
    west: Annotated[float | None, Field(ge=-180, le=180)] = None
    east: Annotated[float | None, Field(ge=-180, le=180)] = None
    limit: Annotated[int, Field(ge=1, le=100)] = 20
    offset: Annotated[int, Field(ge=0, le=10000)] = 0

    @model_validator(mode="after")
    def valid_ranges(self) -> Self:
        for lower, upper in ((self.min_price, self.max_price), (self.min_area, self.max_area)):
            if lower is not None and upper is not None and lower > upper:
                raise ValueError("Minimum cannot exceed maximum")
        bounds = (self.south, self.north, self.west, self.east)
        if any(value is not None for value in bounds):
            if any(value is None for value in bounds):
                raise ValueError("Provide south north west and east together")
            if self.south > self.north:
                raise ValueError("South cannot exceed north")
        return self


class OwnedListingFilters(ListingFilters):
    status: ListingStatus | None = None


class OwnerSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    role: Role


class ListingImageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_id: uuid.UUID
    created_at: datetime

    @computed_field
    @property
    def url(self) -> str:
        return f"/listings/{self.listing_id}/images/{self.id}"


class ListingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    price: Decimal
    currency: str
    area_sq_m: Decimal
    address: str
    city: str
    state: str
    country: str
    latitude: Decimal
    longitude: Decimal
    status: ListingStatus
    created_at: datetime
    updated_at: datetime
    owner: OwnerSummary
    images: list[ListingImageResponse]


class ListingPage(BaseModel):
    items: list[ListingResponse]
    total: int
    limit: int
    offset: int


class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]


class MapProperties(BaseModel):
    title: str
    price: Decimal
    currency: str
    area_sq_m: Decimal
    city: str


class MapFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: uuid.UUID
    geometry: PointGeometry
    properties: MapProperties


class ListingMap(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[MapFeature]
    total: int
    limit: int
    offset: int
