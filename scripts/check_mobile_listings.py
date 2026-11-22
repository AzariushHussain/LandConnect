"""Check the mobile parser against real listing routes using an isolated in-memory DB."""

import json
import os
import subprocess
import sys
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
# Override before importing the backend engine/config; never touch the developer DB.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "isolated-mobile-contract-secret-at-least-32-characters"
os.environ["LIVEKIT_API_KEY"] = "isolated-contract"
os.environ["LIVEKIT_API_SECRET"] = "isolated-contract-secret-at-least-32-characters"

from app.api.routes.listings import router
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.models import Listing, ListingImage, ListingStatus, Role, User


def main() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with TemporaryDirectory(prefix="landconnect-mobile-contract-") as uploads:
        os.environ["UPLOAD_DIR"] = uploads
        get_settings.cache_clear()
        try:
            with Session(engine) as db:
                seller = User(
                    email="mobile-contract@example.com",
                    password_hash="unused-test-only",
                    display_name="Contract seller",
                    role=Role.seller,
                )
                db.add(seller)
                db.flush()
                seller_id = str(seller.id)
                headers = {
                    "Authorization": f"Bearer {create_access_token(seller.id)[0]}"
                }
                buyers = []
                for role in [Role.buyer, Role.seller, Role.broker]:
                    user = User(
                        email=f"{role.value}-contract@example.com",
                        password_hash="unused",
                        display_name=role.value,
                        role=role,
                    )
                    db.add(user)
                    buyers.append(user)
                db.flush()
                other_headers = [
                    {"Authorization": f"Bearer {create_access_token(user.id)[0]}"}
                    for user in buyers
                ]
                rows = []
                for city, price, status in [
                    ("Pune", "1000.00", ListingStatus.active),
                    ("Pune", "2000.00", ListingStatus.active),
                    ("Mumbai", "1000.00", ListingStatus.active),
                    ("Pune", "1500.00", ListingStatus.draft),
                ]:
                    row = Listing(
                        owner_id=seller.id,
                        title=f"{city} plot",
                        description="Test land",
                        price=Decimal(price),
                        currency="INR",
                        area_sq_m=Decimal("500.00"),
                        address="Test road",
                        city=city,
                        state="Maharashtra",
                        country="IN",
                        latitude=Decimal("18.520400"),
                        longitude=Decimal("73.856700"),
                        status=status,
                    )
                    db.add(row)
                    rows.append(row)
                db.flush()
                first_id, draft_id = str(rows[0].id), str(rows[3].id)
                db.add(
                    ListingImage(listing_id=rows[0].id, filename="contract-image.jpg")
                )
                db.commit()

            def database():
                with Session(engine) as db:
                    yield db

            app = FastAPI()
            app.include_router(router)
            app.dependency_overrides[get_db] = database
            with TestClient(app) as client:
                paths = {
                    "first": "/listings?limit=2&offset=0",
                    "second": "/listings?limit=2&offset=2",
                    "filtered": "/listings?city=Pune&currency=INR&min_price=1500&max_price=2500",
                    "detail": f"/listings/{first_id}",
                    "map": "/listings/map?limit=100&offset=0&west=73&south=18&east=74&north=19",
                    "mapFiltered": "/listings/map?limit=100&offset=0&city=Pune&currency=INR&min_price=1500&west=73&south=18&east=74&north=19",
                }
                responses = {name: client.get(path) for name, path in paths.items()}
                for response in responses.values():
                    assert response.status_code == 200
                assert client.get(f"/listings/{draft_id}").status_code == 404
                payload = {
                    name: response.json() for name, response in responses.items()
                }
                payload["firstId"] = first_id
                draft = {
                    "title": "Mobile draft",
                    "description": "An isolated test property",
                    "price": "1234567.89",
                    "currency": "INR",
                    "area_sq_m": "500.00",
                    "address": "Test road",
                    "city": "Pune",
                    "state": "Maharashtra",
                    "country": "IN",
                    "latitude": "18.520400",
                    "longitude": "73.856700",
                    "status": "draft",
                }
                assert client.post("/listings", json=draft).status_code == 401
                assert (
                    client.post(
                        "/listings", json=draft, headers=other_headers[0]
                    ).status_code
                    == 403
                )
                created = client.post("/listings", json=draft, headers=headers)
                assert created.status_code == 201, created.text
                managed_id = created.json()["id"]
                managed_path = f"/listings/{managed_id}"
                payload["ownerId"] = seller_id
                payload["managedDraft"] = created.json()
                assert managed_id not in {
                    feature["id"]
                    for feature in client.get(paths["map"]).json()["features"]
                }
                assert client.get(managed_path).status_code == 404
                assert (
                    client.get(managed_path, headers=other_headers[1]).status_code
                    == 404
                )
                assert (
                    client.patch(
                        managed_path,
                        json={"title": "Wrong owner"},
                        headers=other_headers[1],
                    ).status_code
                    == 404
                )
                mine = client.get("/listings/mine?status=draft", headers=headers)
                assert mine.status_code == 200 and mine.json()["total"] == 2
                assert all(
                    row["owner"]["id"] == seller_id for row in mine.json()["items"]
                )
                assert (
                    client.get("/listings/mine", headers=other_headers[0]).status_code
                    == 403
                )
                photo = BytesIO()
                Image.new("RGB", (64, 32), "green").save(photo, format="JPEG")
                uploaded = client.post(
                    f"{managed_path}/images",
                    headers=headers,
                    files={"file": ("property.jpg", photo.getvalue(), "image/jpeg")},
                )
                assert uploaded.status_code == 201, uploaded.text
                image_url = uploaded.json()["url"]
                assert client.get(image_url).status_code == 404
                private_photo = client.get(image_url, headers=headers)
                assert (
                    private_photo.status_code == 200
                    and private_photo.headers["cache-control"] == "no-store"
                )
                payload["managedWithPhoto"] = client.get(
                    managed_path, headers=headers
                ).json()
                published = client.patch(
                    managed_path,
                    json={"title": "Published mobile plot", "status": "active"},
                    headers=headers,
                )
                assert published.status_code == 200, published.text
                payload["managedActive"] = published.json()
                assert managed_id in {
                    feature["id"]
                    for feature in client.get(paths["map"]).json()["features"]
                }
                assert client.get(managed_path).status_code == 200
                assert client.get(image_url).status_code == 200
                assert (
                    client.patch(
                        managed_path, json={"status": "draft"}, headers=headers
                    ).status_code
                    == 200
                )
                assert client.get(image_url).status_code == 404
                assert client.delete(image_url, headers=headers).status_code == 204
                assert client.get(image_url, headers=headers).status_code == 404
                sold = client.patch(
                    managed_path, json={"status": "sold"}, headers=headers
                )
                assert sold.status_code == 200
                payload["managedSold"] = sold.json()
                assert client.get(managed_path).status_code == 404
                assert (
                    client.get("/listings/mine?status=sold", headers=headers).json()[
                        "total"
                    ]
                    == 1
                )
                assert client.delete(managed_path, headers=headers).status_code == 204
                payload["managedArchived"] = client.get(
                    managed_path, headers=headers
                ).json()
                assert payload["managedArchived"]["status"] == "archived"
                assert client.get(managed_path).status_code == 404
                assert (
                    client.get(
                        "/listings/mine?status=archived", headers=headers
                    ).json()["total"]
                    == 1
                )
                broker = client.post("/listings", json=draft, headers=other_headers[2])
                assert broker.status_code == 201
                # Verify date-line crossing through the same query representation the mobile camera uses.
                for longitude in ["179.500000", "-179.500000"]:
                    result = client.post(
                        "/listings",
                        json={
                            **draft,
                            "title": "Date line plot",
                            "status": "active",
                            "latitude": "0.000000",
                            "longitude": longitude,
                        },
                        headers=headers,
                    )
                    assert result.status_code == 201
                crossing = client.get(
                    "/listings/map?limit=100&offset=0&west=170&south=-10&east=-170&north=10"
                )
                empty_map = client.get(
                    "/listings/map?limit=100&offset=0&west=-10&south=-10&east=10&north=10"
                )
                assert crossing.status_code == 200 and empty_map.status_code == 200
                payload["mapCrossing"], payload["mapEmpty"] = (
                    crossing.json(),
                    empty_map.json(),
                )
                assert payload["mapCrossing"]["total"] == 2
                # A confirmed picker value uses the ordinary listing PATCH, never a separate location write.
                moved = client.patch(
                    managed_path,
                    json={"latitude": "-33.868800", "longitude": "151.209300"},
                    headers=headers,
                )
                assert moved.status_code == 200
                payload["movedProperty"] = moved.json()
            subprocess.run(
                ["node", "--import", "tsx", "tests/verify-backend-contract.ts"],
                cwd=ROOT / "mobile",
                input=json.dumps(payload),
                text=True,
                check=True,
            )
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
