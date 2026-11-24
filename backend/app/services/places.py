import hashlib
import json
import math
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from pydantic import ValidationError
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import Settings
from app.core.errors import Unavailable
from app.schemas.location import LocationAddress, LocationPoint, Place, PlaceQuery, PlaceResults

GATE = "landconnect:places:upstream-slot"
MAX_RESPONSE_BYTES = 256 * 1024


class SearchBusy(Exception):
    pass


def address_fields(props) -> LocationAddress:
    def text(key):
        value = props.get(key)
        return " ".join(value.split()) if isinstance(value, str) else ""

    city = next((text(key) for key in ("city", "town", "village", "municipality") if text(key)), "")
    if not city and props.get("osm_value") in ("city", "town", "village"):
        city = text("name")
    country = text("countrycode")
    return LocationAddress(
        city=city[:100] or None,
        state=text("state")[:100] or None,
        country=country.upper()
        if len(country) == 2 and country.isascii() and country.isalpha()
        else None,
    )


def parse_places(payload) -> PlaceResults:
    if not isinstance(payload, dict) or not isinstance(payload.get("features"), list):
        raise ValueError("Invalid geocoding response")
    items, seen = [], set()
    for feature in payload["features"][:20]:
        try:
            geometry, props = feature["geometry"], feature["properties"]
            if not isinstance(geometry, dict) or not isinstance(props, dict):
                continue
            coordinates = geometry.get("coordinates")
            if (
                geometry.get("type") != "Point"
                or not isinstance(coordinates, list)
                or len(coordinates) != 2
            ):
                continue
            longitude, latitude = coordinates
            if any(type(value) not in (float, int) for value in (longitude, latitude)):
                continue
            parts = list(
                dict.fromkeys(
                    " ".join(props[key].split())
                    for key in ("name", "street", "district", "city", "county", "state", "country")
                    if isinstance(props.get(key), str) and props[key].strip()
                )
            )
            if not parts or props.get("osm_type") not in ("N", "W", "R"):
                continue
            osm_id = props.get("osm_id")
            if type(osm_id) is not int or osm_id <= 0:
                continue
            address = address_fields(props)
            place = Place(
                id=f"{props['osm_type']}:{osm_id}",
                name=parts[0][:150],
                label=", ".join(parts)[:500],
                longitude=longitude,
                latitude=latitude,
                city=address.city,
                state=address.state,
                country=address.country,
            )
            if place.id not in seen:
                items.append(place)
                seen.add(place.id)
            if len(items) == 5:
                break
        except (KeyError, TypeError, ValueError):
            continue
    return PlaceResults(items=items)


def parse_address(payload) -> LocationAddress:
    if not parse_places(payload).items:
        return LocationAddress()
    props = next(
        feature["properties"]
        for feature in payload["features"][:20]
        if parse_places({"features": [feature]}).items
    )

    def text(key):
        value = props.get(key)
        return " ".join(value.split()) if isinstance(value, str) else ""

    fields = address_fields(props)
    city = fields.city
    street = " ".join(filter(None, (text("housenumber"), text("street"))))
    parts = list(
        dict.fromkeys(
            filter(
                None,
                (
                    street or text("name"),
                    text("district"),
                    city,
                    text("state"),
                    text("postcode"),
                    text("country"),
                ),
            )
        )
    )
    return LocationAddress(
        address=", ".join(parts)[:300] or None,
        city=fields.city,
        state=fields.state,
        country=fields.country,
    )


def nearby_city(
    address: LocationAddress, point: LocationPoint, matches: PlaceResults
) -> str | None:
    cities = {}
    for place in matches.items:
        if (
            not place.city
            or not address.state
            or not address.country
            or place.country != address.country
            or not place.state
            or place.state.casefold() != address.state.casefold()
        ):
            continue
        lat = math.radians(place.latitude - point.latitude)
        lon = math.radians(place.longitude - point.longitude)
        distance = (
            2
            * 6371000
            * math.asin(
                min(
                    1,
                    math.sqrt(
                        math.sin(lat / 2) ** 2
                        + math.cos(math.radians(point.latitude))
                        * math.cos(math.radians(place.latitude))
                        * math.sin(lon / 2) ** 2
                    ),
                )
            )
        )
        if distance <= 1000:
            cities[place.city.casefold()] = place.city
    return next(iter(cities.values())) if len(cities) == 1 else None


class PlaceSearch:
    def __init__(self, settings: Settings, cache: Redis):
        self.url = str(settings.geocoding_url)
        self.cache = cache

    def search(self, query: PlaceQuery) -> PlaceResults:
        return self._lookup({"q": query.q, "limit": 5, "lang": "en"})

    def reverse(self, point: LocationPoint) -> LocationAddress:
        address = self._lookup(
            {
                "lon": f"{point.longitude:.6f}",
                "lat": f"{point.latitude:.6f}",
                "limit": 1,
                "lang": "en",
                "radius": 1,
            },
            reverse=True,
        )
        if not address.city and address.address and address.state and address.country:
            try:
                matches = self._lookup(
                    {
                        "q": address.address[:200],
                        "lat": f"{point.latitude:.6f}",
                        "lon": f"{point.longitude:.6f}",
                        "limit": 5,
                        "lang": "en",
                    },
                    wait=True,
                )
                address.city = nearby_city(address, point, matches)
            except (SearchBusy, Unavailable):
                pass
        return address

    def _lookup(self, params: dict, reverse: bool = False, wait: bool = False):
        encoded = urlencode(params)
        digest = hashlib.sha256(f"{self.url}|{reverse}|{encoded.casefold()}".encode()).hexdigest()
        key = f"landconnect:places:v2:{digest}"
        model = LocationAddress if reverse else PlaceResults
        try:
            cached = self.cache.get(key)
            if cached:
                try:
                    return model.model_validate_json(cached)
                except ValidationError:
                    pass
            # One shared slot across API workers; never query upstream if Redis is unavailable.
            if not self.cache.set(GATE, "1", nx=True, ex=1):
                if not wait:
                    raise SearchBusy()
                time.sleep(1)
                if not self.cache.set(GATE, "1", nx=True, ex=1):
                    raise SearchBusy()
            url = urlsplit(self.url)
            path = url.path.rstrip("/").rsplit("/", 1)[0] + "/reverse" if reverse else url.path
            request = Request(
                urlunsplit((url.scheme, url.netloc, path, encoded, "")),
                headers={"Accept": "application/json", "User-Agent": "LandConnect/0.1 PlaceSearch"},
            )
            try:
                with urlopen(request, timeout=5) as response:
                    raw = response.read(MAX_RESPONSE_BYTES + 1)
            except HTTPError as failure:
                if failure.code == 429:
                    self.cache.setex(GATE, 30, "1")
                raise
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError("Geocoding response too large")
            results = parse_address(json.loads(raw)) if reverse else parse_places(json.loads(raw))
            self.cache.setex(key, 86400, results.model_dump_json())
            return results
        except SearchBusy:
            raise
        except (RedisError, URLError, OSError, ValueError):
            raise Unavailable(
                "Place search is unavailable. You can still select on the map."
            ) from None
