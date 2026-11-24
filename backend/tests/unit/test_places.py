import io
import json
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import ValidationError
from redis.exceptions import ConnectionError

from app.api.routes.locations import place_search
from app.core.errors import Unavailable
from app.main import app
from app.schemas.location import LocationAddress, LocationPoint, PlaceQuery
from app.services import places


def feature(number=1, **changes):
    return {
        "geometry": {"type": "Point", "coordinates": [73.8545071, 18.5213738]},
        "properties": {
            "osm_type": "N",
            "osm_id": number,
            "name": "Pune",
            "state": "Maharashtra",
            "country": "India",
        },
        **changes,
    }


class Cache:
    def __init__(self):
        self.data = {}
        self.expirations = {}

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value, *, nx, ex):
        assert nx and ex == 1
        if key in self.data:
            return False
        self.data[key] = value
        return True

    def setex(self, key, seconds, value):
        self.data[key] = value
        self.expirations[key] = seconds


def service(cache=None):
    return places.PlaceSearch(
        SimpleNamespace(geocoding_url="https://photon.example/api/"), cache or Cache()
    )


def test_query_normalization_and_limits():
    assert PlaceQuery(q="  Pune   city ").q == "Pune city"
    for query in ("a", "   ", "x" * 201, None):
        with pytest.raises(ValidationError):
            PlaceQuery(q=query)


def test_parse_places_validates_points_deduplicates_and_drops_provider_fields():
    invalid = [
        None,
        {},
        {"geometry": None, "properties": []},
        feature(geometry={"type": "Point", "coordinates": [True, 2]}),
        feature(geometry={"type": "Point", "coordinates": [181, 2]}),
        feature(geometry={"type": "Point", "coordinates": [1, float("nan")]}),
        feature(geometry={"type": "LineString", "coordinates": [[1, 2]]}),
    ]
    result = places.parse_places({"features": invalid + [feature(), feature()]})
    assert len(result.items) == 1
    assert result.items[0].longitude == 73.8545071
    assert result.items[0].latitude == 18.5213738
    assert result.items[0].label == "Pune, Maharashtra, India"
    assert set(result.items[0].model_dump()) == {
        "id",
        "name",
        "label",
        "longitude",
        "latitude",
        "city",
        "state",
        "country",
    }
    assert len(places.parse_places({"features": [feature(n) for n in range(1, 10)]}).items) == 5
    with pytest.raises(ValueError):
        places.parse_places({"features": None})


def test_upstream_request_is_bounded_encoded_identified_and_cached(monkeypatch):
    requests = []

    def upstream(request, timeout):
        requests.append(request)
        assert timeout == 5
        return io.BytesIO(json.dumps({"features": [feature()]}).encode())

    monkeypatch.setattr(places, "urlopen", upstream)
    search = service()
    first = search.search(PlaceQuery(q="  Pune & road "))
    assert search.search(PlaceQuery(q="pune & ROAD")) == first
    assert len(requests) == 1
    assert parse_qs(urlsplit(requests[0].full_url).query) == {
        "q": ["Pune & road"],
        "limit": ["5"],
        "lang": ["en"],
    }
    assert requests[0].get_header("User-agent") == "LandConnect/0.1 PlaceSearch"
    assert 86400 in search.cache.expirations.values()
    assert all("pune" not in key.lower() for key in search.cache.data)


def test_rate_slot_is_shared_between_workers_and_redis_outage_prevents_upstream(monkeypatch):
    requests = []
    monkeypatch.setattr(
        places, "urlopen", lambda *a, **kw: requests.append(a) or io.BytesIO(b'{"features":[]}')
    )
    cache = Cache()
    service(cache).search(PlaceQuery(q="Pune"))
    with pytest.raises(places.SearchBusy):
        service(cache).search(PlaceQuery(q="Mumbai"))
    assert len(requests) == 1

    def unavailable(key):
        raise ConnectionError("private Redis credentials")

    cache.get = unavailable
    with pytest.raises(Unavailable, match="Place search is unavailable") as error:
        service(cache).search(PlaceQuery(q="New Delhi"))
    assert "credentials" not in str(error.value)
    assert len(requests) == 1


@pytest.mark.parametrize(
    "failure", [URLError("private upstream address"), TimeoutError(), ValueError()]
)
def test_provider_errors_are_safe_and_not_retried(monkeypatch, failure):
    calls = []

    def upstream(*args, **kwargs):
        calls.append(1)
        raise failure

    monkeypatch.setattr(places, "urlopen", upstream)
    with pytest.raises(Unavailable) as error:
        service().search(PlaceQuery(q="Pune"))
    assert "private" not in str(error.value)
    assert len(calls) == 1


def test_oversized_response_is_rejected_and_upstream_throttling_adds_cooldown(monkeypatch):
    monkeypatch.setattr(
        places, "urlopen", lambda *a, **kw: io.BytesIO(b"x" * (places.MAX_RESPONSE_BYTES + 1))
    )
    with pytest.raises(Unavailable):
        service().search(PlaceQuery(q="Pune"))

    def throttled(*args, **kwargs):
        raise HTTPError("https://example.test", 429, "Limited", {}, None)

    monkeypatch.setattr(places, "urlopen", throttled)
    search = service()
    with pytest.raises(Unavailable):
        search.search(PlaceQuery(q="Pune"))
    assert search.cache.expirations[places.GATE] == 30


def test_location_endpoint_checks_roles_normalizes_and_returns_no_store(auth_client):
    client, _ = auth_client
    queries = []

    def lookup(query):
        queries.append(query.q)
        return places.parse_places({"features": [feature()]})

    app.dependency_overrides[place_search] = lambda: SimpleNamespace(search=lookup)
    assert client.post("/locations/search", json={"q": "Pune"}).status_code == 401
    for role in ("buyer", "seller", "broker"):
        client.post(
            "/auth/register",
            json={
                "email": f"{role}@example.com",
                "display_name": role,
                "password": "LandConnect@123",
                "role": role,
            },
        )
        token = client.post(
            "/auth/login", json={"email": f"{role}@example.com", "password": "LandConnect@123"}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/locations/search", headers=headers, json={"q": " Pune   city "})
        if role == "buyer":
            assert response.status_code == 403
        else:
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert response.json()["items"][0]["id"] == "N:1"
            assert (
                client.post("/locations/search", headers=headers, json={"q": "x"}).status_code
                == 422
            )

            def busy(query):
                raise places.SearchBusy()

            app.dependency_overrides[place_search] = lambda: SimpleNamespace(search=busy)
            limited = client.post("/locations/search", headers=headers, json={"q": "Pune"})
            assert limited.status_code == 429 and limited.headers["retry-after"] == "1"
            app.dependency_overrides[place_search] = lambda: SimpleNamespace(search=lookup)
    assert queries == ["Pune city", "Pune city"]


def test_reverse_address_maps_known_fields_and_keeps_country_as_iso_code():
    row = feature()
    row["properties"].update(housenumber="14", street="Test Road", city="Pune", countrycode="in")
    invalid = feature(geometry={"type": "Point", "coordinates": [999, 0]})
    invalid["properties"]["city"] = "Wrong city"
    result = places.parse_address({"features": [invalid, row]})
    assert result.model_dump(exclude_none=True) == {
        "address": "14 Test Road, Pune, Maharashtra, India",
        "city": "Pune",
        "state": "Maharashtra",
        "country": "IN",
    }
    assert places.parse_address({"features": []}).model_dump(exclude_none=True) == {}
    row["properties"] = {
        "name": "Open field",
        "osm_type": "W",
        "osm_id": 2,
        "countrycode": "invalid",
    }
    partial = places.parse_address({"features": [row]}).model_dump(exclude_none=True)
    assert partial == {"address": "Open field"}


def test_reverse_uses_sibling_endpoint_coordinates_and_shared_cache(monkeypatch):
    requests = []
    row = feature()
    row["properties"].update(city="Pune", countrycode="IN")

    def upstream(request, timeout):
        requests.append(request)
        return io.BytesIO(json.dumps({"features": [row]}).encode())

    monkeypatch.setattr(places, "urlopen", upstream)
    search = service()
    point = LocationPoint(latitude=18.52, longitude=73.85)
    assert search.reverse(point).country == "IN"
    assert search.reverse(point).city == "Pune"
    assert len(requests) == 1
    assert urlsplit(requests[0].full_url).path == "/reverse"
    assert parse_qs(urlsplit(requests[0].full_url).query) == {
        "lat": ["18.520000"],
        "lon": ["73.850000"],
        "limit": ["1"],
        "lang": ["en"],
        "radius": ["1"],
    }
    with pytest.raises(places.SearchBusy):
        search.search(PlaceQuery(q="Pune"))
    for latitude, longitude in [(91, 10), (20, -181), (float("nan"), 10), (True, 1), ("20", 10)]:
        with pytest.raises(ValidationError):
            LocationPoint(latitude=latitude, longitude=longitude)


def test_reverse_endpoint_enforces_manager_access_and_validates_point(auth_client):
    client, _ = auth_client
    points = []

    def lookup(point):
        points.append(point)
        return LocationAddress(address="Test Road", city="Pune", country="IN")

    app.dependency_overrides[place_search] = lambda: SimpleNamespace(reverse=lookup)
    payload = {"latitude": 18.52, "longitude": 73.85}
    assert client.post("/locations/reverse", json=payload).status_code == 401
    for role in ("buyer", "seller", "broker"):
        client.post(
            "/auth/register",
            json={
                "email": f"{role}@example.com",
                "display_name": role,
                "password": "LandConnect@123",
                "role": role,
            },
        )
        token = client.post(
            "/auth/login", json={"email": f"{role}@example.com", "password": "LandConnect@123"}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/locations/reverse", json=payload, headers=headers)
        if role == "buyer":
            assert response.status_code == 403
        else:
            assert response.status_code == 200
            assert response.json() == {"address": "Test Road", "city": "Pune", "country": "IN"}
            assert response.headers["cache-control"] == "no-store"
            assert (
                client.post(
                    "/locations/reverse", json={**payload, "latitude": 91}, headers=headers
                ).status_code
                == 422
            )
    assert len(points) == 2


def test_hsr_city_is_resolved_from_nearby_address_in_same_state_and_country(monkeypatch):
    point = LocationPoint(latitude=12.911622, longitude=77.638862)
    address = LocationAddress(
        address="HSR Layout, Karnataka, India", state="Karnataka", country="IN"
    )
    nearby = feature(geometry={"type": "Point", "coordinates": [77.6374623, 12.9137415]})
    nearby["properties"].update(city="Bengaluru", state="Karnataka", countrycode="IN")
    matches = places.parse_places({"features": [nearby]})
    search = service()
    requests = []

    def lookup(params, reverse=False, wait=False):
        requests.append((params, reverse, wait))
        return address if reverse else matches

    monkeypatch.setattr(search, "_lookup", lookup)
    assert search.reverse(point).city == "Bengaluru"
    assert requests[1][0]["q"] == "HSR Layout, Karnataka, India"
    assert requests[1][2] is True


def test_city_enrichment_rejects_distant_conflicting_or_wrong_state_results():
    point = LocationPoint(latitude=12.911622, longitude=77.638862)
    address = LocationAddress(state="Karnataka", country="IN")
    row = feature(geometry={"type": "Point", "coordinates": [77.6374623, 12.9137415]})
    row["properties"].update(city="Bengaluru", state="Karnataka", countrycode="IN")
    for changes in [{"state": "Telangana"}, {"countrycode": "US"}]:
        wrong = {**row, "properties": {**row["properties"], **changes}}
        assert (
            places.nearby_city(address, point, places.parse_places({"features": [wrong]})) is None
        )
    far = {**row, "geometry": {"type": "Point", "coordinates": [78.4, 17.4]}}
    assert places.nearby_city(address, point, places.parse_places({"features": [far]})) is None
    conflicting = {**row, "properties": {**row["properties"], "osm_id": 2, "city": "Other city"}}
    assert (
        places.nearby_city(address, point, places.parse_places({"features": [row, conflicting]}))
        is None
    )


def test_internal_city_lookup_waits_once_for_shared_slot_without_bypassing_gate(monkeypatch):
    search = service()
    search.cache.data[places.GATE] = "1"
    waits = []

    def tick(seconds):
        waits.append(seconds)
        search.cache.data.pop(places.GATE)

    monkeypatch.setattr(places.time, "sleep", tick)
    monkeypatch.setattr(places, "urlopen", lambda *a, **kw: io.BytesIO(b'{"features":[]}'))
    search._lookup({"q": "HSR Layout", "limit": 5}, wait=True)
    assert waits == [1]
    assert search.cache.get(places.GATE) == "1"
