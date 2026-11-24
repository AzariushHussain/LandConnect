from typing import Annotated

from pydantic import BaseModel, Field, FiniteFloat, StringConstraints, field_validator


class PlaceQuery(BaseModel):
    q: Annotated[str, StringConstraints(min_length=3, max_length=200)]

    @field_validator("q", mode="before")
    @classmethod
    def normalize_query(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


class Place(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    label: str = Field(min_length=1, max_length=500)
    longitude: Annotated[FiniteFloat, Field(ge=-180, le=180)]
    latitude: Annotated[FiniteFloat, Field(ge=-90, le=90)]
    city: str | None = Field(default=None, min_length=1, max_length=100)
    state: str | None = Field(default=None, min_length=1, max_length=100)
    country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")


class PlaceResults(BaseModel):
    items: list[Place] = Field(max_length=5)


class LocationPoint(BaseModel):
    longitude: Annotated[FiniteFloat, Field(ge=-180, le=180, strict=True)]
    latitude: Annotated[FiniteFloat, Field(ge=-90, le=90, strict=True)]


class LocationAddress(BaseModel):
    address: str | None = Field(default=None, min_length=1, max_length=300)
    city: str | None = Field(default=None, min_length=1, max_length=100)
    state: str | None = Field(default=None, min_length=1, max_length=100)
    country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
