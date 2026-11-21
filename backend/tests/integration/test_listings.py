import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models import Role, User

pytestmark = pytest.mark.postgres


def test_postgres_listing_ownership_images_and_map(migrated_database, monkeypatch, tmp_path):
    engine, _ = migrated_database
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "images"))
    get_settings.cache_clear()
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            email="seller@example.com",
            display_name="Seller",
            role=Role.seller,
            password_hash="not-used-in-listing-tests",
        )
        db.add(user)
        db.commit()
        token, _ = create_access_token(user.id)
    headers = {"Authorization": f"Bearer {token}"}

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            created = client.post(
                "/listings",
                headers=headers,
                json={
                    "title": "Property",
                    "description": "Road access",
                    "price": "1000.00",
                    "area_sq_m": "100.00",
                    "address": "Road",
                    "city": "Bengaluru",
                    "state": "Karnataka",
                    "latitude": "12.97",
                    "longitude": "77.59",
                },
            )
            assert created.status_code == 201
            path = f"/listings/{created.json()['id']}"
            assert client.get(path).status_code == 404
            content = io.BytesIO()
            with Image.new("RGB", (20, 10), "green") as picture:
                picture.save(content, "PNG")
            uploaded = client.post(
                path + "/images",
                headers=headers,
                files={"file": ("photo.png", content.getvalue(), "image/png")},
            )
            assert uploaded.status_code == 201
            updated = client.patch(
                path, headers=headers, json={"status": "active", "price": "2000.00"}
            )
            assert updated.status_code == 200
            assert updated.json()["price"] == "2000.00"
            assert client.get(uploaded.json()["url"]).status_code == 200
            mapped = client.get("/listings/map?south=12&north=13&west=77&east=78").json()
            assert mapped["total"] == 1
            assert mapped["features"][0]["geometry"]["coordinates"] == [77.59, 12.97]
            assert client.delete(path, headers=headers).status_code == 204
            assert client.get(uploaded.json()["url"]).status_code == 404
            assert client.delete(uploaded.json()["url"], headers=headers).status_code == 204
            assert list((tmp_path / "images").iterdir()) == []
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()
