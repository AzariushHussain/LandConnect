"""Check the mobile parser against real listing routes using an isolated in-memory DB."""

import json
import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
# Override before importing the backend engine/config; never touch the developer DB.
os.environ["DATABASE_URL"] = "sqlite://"

from app.api.routes.listings import router
from app.db.base import Base
from app.db.session import get_db
from app.models import Listing, ListingImage, ListingStatus, Role, User


def main() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
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
            db.add(ListingImage(listing_id=rows[0].id, filename="contract-image.jpg"))
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
            }
            responses = {name: client.get(path) for name, path in paths.items()}
            for response in responses.values():
                assert response.status_code == 200
            assert client.get(f"/listings/{draft_id}").status_code == 404
            payload = {name: response.json() for name, response in responses.items()}
            payload["firstId"] = first_id
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
