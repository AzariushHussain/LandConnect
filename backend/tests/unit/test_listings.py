import io
import uuid
from types import SimpleNamespace

import pytest
from PIL import Image, PngImagePlugin
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.middleware import MAX_REQUEST_BYTES
from app.core.config import get_settings
from app.core.security import create_access_token
from app.models import ListingImage, Role, User
from app.services import listings, media


def listing_data(**changes):
    return {
        "title": "Roadside land",
        "description": "Land with road access",
        "price": "150000.00",
        "area_sq_m": "500.00",
        "address": "Test road",
        "city": "Bengaluru",
        "state": "Karnataka",
        "latitude": "12.971599",
        "longitude": "77.594566",
        **changes,
    }


def png_bytes(size=(20, 10), metadata=False):
    result = io.BytesIO()
    with Image.new("RGBA", size, (255, 0, 0, 0)) as image:
        info = PngImagePlugin.PngInfo()
        if metadata:
            info.add_text("Comment", "private-location-metadata")
        image.save(result, format="PNG", pnginfo=info)
    return result.getvalue()


@pytest.fixture
def market(auth_client, monkeypatch, tmp_path):
    client, engine = auth_client
    directory = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_DIR", str(directory))
    get_settings.cache_clear()
    headers, users = {}, {}
    with Session(engine, expire_on_commit=False) as db:
        for name, role in (
            ("seller", Role.seller),
            ("broker", Role.broker),
            ("other", Role.seller),
            ("buyer", Role.buyer),
        ):
            user = User(
                email=f"{name}@example.com",
                password_hash="not-used-in-listing-tests",
                display_name=name,
                role=role,
            )
            db.add(user)
            db.flush()
            users[name] = user.id
            token, _ = create_access_token(user.id)
            headers[name] = {"Authorization": f"Bearer {token}"}
        db.commit()
    yield SimpleNamespace(
        client=client, engine=engine, headers=headers, users=users, directory=directory
    )
    get_settings.cache_clear()


def create(market, actor="seller", **changes):
    response = market.client.post(
        "/listings", headers=market.headers[actor], json=listing_data(**changes)
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload(market, listing_id, actor="seller", content=None, filename="property.png"):
    return market.client.post(
        f"/listings/{listing_id}/images",
        headers=market.headers[actor],
        files={"file": (filename, content if content is not None else png_bytes(), "image/png")},
    )


@pytest.mark.parametrize(
    "actor,status", [("seller", 201), ("broker", 201), ("buyer", 403), (None, 401)]
)
def test_only_sellers_and_brokers_create_listings(market, actor, status):
    response = market.client.post(
        "/listings", json=listing_data(), headers=market.headers[actor] if actor else {}
    )
    assert response.status_code == status
    if status == 201:
        assert response.json()["owner"]["id"] == str(market.users[actor])
        assert response.json()["status"] == "draft"


def test_community_visibility_and_contact_privacy(market):
    active = create(market, status="active")
    private = [create(market, status=status) for status in ("draft", "sold", "archived")]
    page = market.client.get("/listings").json()
    assert page["total"] == 1 and page["items"][0]["id"] == active["id"]
    assert set(page["items"][0]["owner"]) == {"id", "display_name", "role"}
    assert "seller@example.com" not in str(page)
    for listing in private:
        path = f"/listings/{listing['id']}"
        assert market.client.get(path).status_code == 404
        assert market.client.get(path, headers=market.headers["other"]).status_code == 404
        assert market.client.get(path, headers=market.headers["seller"]).status_code == 200
    mine = market.client.get("/listings/mine", headers=market.headers["seller"]).json()
    assert mine["total"] == 4
    assert (
        market.client.get("/listings/mine", headers=market.headers["seller"]).headers[
            "cache-control"
        ]
        == "no-store"
    )
    drafts = market.client.get(
        "/listings/mine?status=draft", headers=market.headers["seller"]
    ).json()
    assert drafts["total"] == 1
    assert market.client.get("/listings/mine", headers=market.headers["other"]).json()["total"] == 0
    assert market.client.get("/listings/mine", headers=market.headers["buyer"]).status_code == 403
    assert market.client.get(f"/listings/{uuid.uuid4()}").status_code == 404


def test_only_owner_can_edit_archive_or_upload(market):
    listing = create(market)
    path = f"/listings/{listing['id']}"
    assert (
        market.client.patch(
            path, json={"price": "120000.00"}, headers=market.headers["other"]
        ).status_code
        == 404
    )
    assert market.client.delete(path, headers=market.headers["other"]).status_code == 404
    assert upload(market, listing["id"], actor="other").status_code == 404
    assert (
        market.client.patch(
            path, json={"status": "active"}, headers=market.headers["buyer"]
        ).status_code
        == 403
    )
    updated = market.client.patch(
        path, headers=market.headers["seller"], json={"price": "120000.00", "status": "active"}
    )
    assert updated.status_code == 200
    assert updated.json()["price"] == "120000.00"
    assert market.client.get(path).status_code == 200
    assert market.client.delete(path, headers=market.headers["seller"]).status_code == 204
    assert market.client.get(path).status_code == 404
    assert market.client.get("/listings/map").json()["total"] == 0
    assert market.client.get(path, headers=market.headers["seller"]).json()["status"] == "archived"
    assert market.client.delete(path, headers=market.headers["seller"]).status_code == 204
    assert (
        market.client.patch(
            path, headers=market.headers["seller"], json={"status": "active"}
        ).status_code
        == 200
    )


def test_pagination_is_bounded_and_stable(market):
    ids = {create(market, status="active")["id"] for _ in range(3)}
    first = market.client.get("/listings?limit=2").json()
    second = market.client.get("/listings?limit=2&offset=2").json()
    assert first["total"] == second["total"] == 3
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert {item["id"] for item in first["items"] + second["items"]} == ids
    assert market.client.get("/listings?offset=10").json()["items"] == []
    assert market.client.get("/listings?limit=101").status_code == 422


@pytest.mark.parametrize(
    "query,expected",
    [
        ({"city": "bengaluru"}, 2),
        ({"state": "Karnataka", "currency": "INR"}, 1),
        ({"min_price": "150", "max_price": "250"}, 1),
        ({"min_area": "200", "max_area": "400"}, 1),
        ({"q": "%"}, 1),
        ({"q": "_"}, 1),
        ({"q": "' OR 1=1 --"}, 0),
        ({"country": "IN", "q": "road access"}, 3),
    ],
)
def test_feed_filters_and_literal_search(market, query, expected):
    create(
        market,
        title="100% farmland",
        city="Delhi",
        state="Delhi",
        price="100.00",
        area_sq_m="100.00",
        status="active",
    )
    create(market, title="Site_A", price="200.00", area_sq_m="300.00", status="active")
    create(market, currency="USD", price="300.00", area_sq_m="500.00", status="active")
    response = market.client.get("/listings", params=query)
    assert response.status_code == 200
    assert response.json()["total"] == expected
    assert market.client.get("/listings/map", params=query).json()["total"] == expected


def test_map_returns_longitude_latitude_and_handles_dateline_bounds(market):
    listing = create(market, status="active")
    create(market, latitude="0", longitude="179", status="active")
    create(market, latitude="0", longitude="-179", status="active")
    create(market, latitude="0", longitude="0", status="active")
    create(market, latitude="0", longitude="179", status="draft")
    response = market.client.get(
        "/listings/map", params={"south": 12, "north": 13, "west": 77, "east": 78}
    ).json()
    assert response["type"] == "FeatureCollection" and response["total"] == 1
    feature = response["features"][0]
    assert feature["id"] == listing["id"]
    assert feature["geometry"] == {"type": "Point", "coordinates": [77.594566, 12.971599]}
    crossing = market.client.get(
        "/listings/map", params={"south": -1, "north": 1, "west": 170, "east": -170}
    ).json()
    assert crossing["total"] == 2


@pytest.mark.parametrize(
    "query",
    [
        {"min_price": 10, "max_price": 1},
        {"min_area": 10, "max_area": 1},
        {"south": 1},
        {"south": 10, "north": 0, "west": 0, "east": 1},
        {"south": 0, "north": 1, "west": 200, "east": 1},
        {"south": "nan", "north": 1, "west": 0, "east": 1},
        {"offset": -1},
        {"status": "draft"},
        {"unknown": "x"},
    ],
)
def test_invalid_filters_are_rejected(market, query):
    assert market.client.get("/listings", params=query).status_code == 422


@pytest.mark.parametrize(
    "invalid",
    [
        {"price": 0},
        {"price": "1000000000000.00"},
        {"area_sq_m": -1},
        {"latitude": 91},
        {"longitude": -181},
        {"latitude": "12.1234567"},
        {"title": "   "},
        {"description": "x" * 10001},
        {"currency": "inr"},
        {"country": "IND"},
        {"owner_id": str(uuid.uuid4())},
        {"status": "unknown"},
    ],
)
def test_listing_validation(market, invalid):
    response = market.client.post(
        "/listings", headers=market.headers["seller"], json=listing_data(**invalid)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("changes", [{}, {"title": None}, {"price": 0}, {"owner_id": "x"}])
def test_invalid_partial_updates_do_not_change_listing(market, changes):
    listing = create(market)
    path = f"/listings/{listing['id']}"
    assert (
        market.client.patch(path, headers=market.headers["seller"], json=changes).status_code == 422
    )
    assert (
        market.client.get(path, headers=market.headers["seller"]).json()["title"]
        == listing["title"]
    )


def test_images_are_normalized_private_and_removed(market):
    listing = create(market)
    response = upload(
        market, listing["id"], content=png_bytes(metadata=True), filename="../../secret.php"
    )
    assert response.status_code == 201
    image = response.json()
    assert "filename" not in image
    assert market.client.get(image["url"]).status_code == 404
    assert market.client.get(image["url"], headers=market.headers["other"]).status_code == 404
    preview = market.client.get(image["url"], headers=market.headers["seller"])
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/jpeg"
    assert preview.headers["cache-control"] == "no-store"
    assert preview.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(preview.content)) as normalized:
        assert normalized.format == "JPEG"
        assert not normalized.getexif()
        assert normalized.getpixel((0, 0)) == (255, 255, 255)
    assert b"private-location-metadata" not in preview.content
    assert len(list(market.directory.glob("*.jpg"))) == 1
    path = f"/listings/{listing['id']}"
    assert (
        market.client.patch(
            path, headers=market.headers["seller"], json={"status": "active"}
        ).status_code
        == 200
    )
    assert market.client.get(image["url"]).status_code == 200
    assert market.client.get(path).json()["images"][0]["url"] == image["url"]
    assert market.client.delete(image["url"], headers=market.headers["other"]).status_code == 404
    assert market.client.delete(path, headers=market.headers["seller"]).status_code == 204
    assert market.client.get(image["url"]).status_code == 404
    assert market.client.get(image["url"], headers=market.headers["seller"]).status_code == 200
    assert market.client.delete(image["url"], headers=market.headers["seller"]).status_code == 204
    assert market.client.get(image["url"], headers=market.headers["seller"]).status_code == 404
    assert list(market.directory.iterdir()) == []


@pytest.mark.parametrize("content", [b"not an image", b"<svg></svg>", b"GIF89a broken data"])
def test_invalid_image_content_is_rejected(market, content):
    listing = create(market)
    assert upload(market, listing["id"], content=content).status_code == 422
    assert not market.directory.exists()


def test_image_limits_and_resize(market):
    listing = create(market)
    assert (
        upload(market, listing["id"], content=b"x" * (media.MAX_IMAGE_BYTES + 1)).status_code == 413
    )
    too_many_pixels = upload(market, listing["id"], content=png_bytes((4000, 4000)))
    assert too_many_pixels.status_code == 422
    assert "12 million" in too_many_pixels.json()["detail"]
    resized = upload(market, listing["id"], content=png_bytes((3000, 1000)))
    assert resized.status_code == 201
    with Image.open(
        io.BytesIO(
            market.client.get(resized.json()["url"], headers=market.headers["seller"]).content
        )
    ) as image:
        assert image.width == 2048 and image.height < 1000


def test_jpeg_orientation_is_applied_and_exif_removed():
    content = io.BytesIO()
    with Image.new("RGB", (20, 10), "red") as picture:
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = "private-location-metadata"
        picture.save(content, "JPEG", exif=exif)
    encoded = media.prepare_image(io.BytesIO(content.getvalue()))
    with Image.open(io.BytesIO(encoded)) as image:
        assert image.size == (10, 20)
        assert not image.getexif()
    assert b"private-location-metadata" not in encoded


def test_image_ids_cannot_be_used_under_another_listing(market):
    public = create(market, status="active")
    private = create(market, actor="broker")
    image = upload(market, private["id"], actor="broker").json()
    substituted = f"/listings/{public['id']}/images/{image['id']}"
    assert market.client.get(substituted).status_code == 404
    assert market.client.delete(substituted, headers=market.headers["seller"]).status_code == 404
    assert market.client.get(image["url"], headers=market.headers["broker"]).status_code == 200


def test_image_count_limit(market):
    listing = create(market)
    with Session(market.engine) as db:
        for _ in range(10):
            db.add(
                ListingImage(
                    listing_id=uuid.UUID(listing["id"]), filename=uuid.uuid4().hex + ".jpg"
                )
            )
        db.commit()
    assert upload(market, listing["id"]).status_code == 409
    assert not market.directory.exists()


def test_failed_image_commit_removes_file(market, monkeypatch):
    listing = create(market)
    with Session(market.engine) as db:
        row = listings.owned_listing(db, uuid.UUID(listing["id"]), market.users["seller"])

        def fail():
            raise SQLAlchemyError("test commit failure")

        monkeypatch.setattr(db, "commit", fail)
        with pytest.raises(SQLAlchemyError):
            media.add_image(db, row, io.BytesIO(png_bytes()))
    assert list(market.directory.iterdir()) == []


@pytest.mark.parametrize("filename", ["../.env", "/etc/passwd", "file.svg", "x.jpg"])
def test_storage_paths_reject_untrusted_names(market, filename):
    assert media.image_path(filename) is None


def test_request_body_limit_including_chunked_content(market):
    payload = b"x" * (MAX_REQUEST_BYTES + 1)
    response = market.client.post("/auth/register", content=payload)
    assert response.status_code == 413
    streamed = market.client.post(
        "/auth/register", content=iter([payload]), headers={"Content-Type": "application/json"}
    )
    assert streamed.status_code == 413


def test_invalid_content_length(market):
    assert (
        market.client.post(
            "/auth/register", content=b"{}", headers={"Content-Length": "invalid"}
        ).status_code
        == 400
    )


def test_invalid_bearer_token_does_not_open_private_listing(market):
    listing = create(market)
    response = market.client.get(
        f"/listings/{listing['id']}", headers={"Authorization": "Bearer invalid"}
    )
    assert response.status_code == 401
