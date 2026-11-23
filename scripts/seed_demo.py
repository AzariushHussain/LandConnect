"""Add reusable demo accounts/content through a private development API without resetting data."""

import argparse
import io
import ipaddress
import os
import uuid
from collections import Counter
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageDraw, ImageFont

PASSWORD = "LandConnect@123"
PREFIX = "[LC DEMO]"
ACCOUNTS = [
    {
        "key": f"{role}{number}",
        "email": f"{role}{number}@example.com",
        "display_name": f"Demo {role.title()} {number}",
        "role": role,
    }
    for role in ("buyer", "seller", "broker")
    for number in (1, 2)
]
PLACES = [
    ("seller1", "Pune", "Maharashtra", "18.520400", "73.856700"),
    ("seller2", "Bengaluru", "Karnataka", "12.971600", "77.594600"),
    ("broker1", "Hyderabad", "Telangana", "17.385000", "78.486700"),
    ("broker2", "Chennai", "Tamil Nadu", "13.082700", "80.270700"),
]


def private_origin(value: str) -> str:
    url = urlsplit(value)
    if (
        url.scheme not in ("http", "https")
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in ("", "/")
    ):
        raise argparse.ArgumentTypeError(
            "Use a private API origin without credentials or a path"
        )
    if url.hostname != "localhost":
        try:
            address = ipaddress.ip_address(url.hostname)
        except ValueError:
            raise argparse.ArgumentTypeError(
                "Use localhost or a literal private LAN address"
            ) from None
        allowed = address.is_loopback or any(
            address in ipaddress.ip_network(cidr)
            for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        )
        if not allowed:
            raise argparse.ArgumentTypeError(
                "Demo seeding is restricted to local/private APIs"
            )
    return value.rstrip("/")


def stable_id(value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "landconnect-demo-v1:" + value))


def sample_photo(title: str, city: str, variant: int) -> bytes:
    """Clearly marked illustrations, never represented as photographs of actual properties."""
    image = Image.new("RGB", (1000, 650), "#DDEDE5")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=27)
    small = ImageFont.load_default(size=21)
    draw.rectangle(
        (0, 270, 1000, 650), fill=("#729C61", "#83A76C", "#75976D")[variant % 3]
    )
    draw.ellipse((760, 60, 850, 150), fill="#F0CD75")
    draw.polygon(
        [(0, 390), (380, 255), (1000, 390), (1000, 445), (380, 310), (0, 445)],
        fill="#BBB6A4",
    )
    draw.polygon(
        [(190, 355), (540, 370), (810, 545), (350, 560)],
        fill="#BBD29D",
        outline="#F5F1D7",
        width=7,
    )
    draw.line((355, 555, 350, 420), fill="#FFFFFF", width=5)
    draw.line((350, 420, 440, 432), fill="#E9B86B", width=7)
    draw.rectangle((0, 0, 1000, 56), fill="#204E3B")
    draw.text((24, 13), "LANDCONNECT  /  DEMO PROPERTY", fill="white", font=font)
    draw.rectangle((0, 575, 1000, 650), fill="#FFFFFF")
    draw.text(
        (24, 588),
        f"{city} - {title.replace(PREFIX, '').strip()}",
        fill="#204E3B",
        font=font,
    )
    draw.text(
        (24, 624),
        "Synthetic illustration and sample location; not a real offer.",
        fill="#48564D",
        font=small,
    )
    output = io.BytesIO()
    image.save(output, "JPEG", quality=88)
    return output.getvalue()


class DemoSeed:
    def __init__(self, client: httpx.Client, password: str):
        self.client, self.password = client, password
        self.users, self.tokens = {}, {}
        self.counts = Counter()

    def request(self, method: str, path: str, actor: str | None = None, **kwargs):
        headers = {"Authorization": "Bearer " + self.tokens[actor]} if actor else {}
        response = self.client.request(method, path, headers=headers, **kwargs)
        if not response.is_success:
            raise RuntimeError(
                f"{method} {path} returned HTTP {response.status_code}; existing records were preserved"
            )
        return response

    def pages(self, path: str, actor: str) -> list[dict]:
        items, offset = [], 0
        while offset <= 10000:
            page = self.request(
                "GET", path, actor, params={"limit": 100, "offset": offset}
            ).json()
            items.extend(page["items"])
            if len(page["items"]) < 100:
                return items
            offset += len(page["items"])
        raise RuntimeError("Demo lookup exceeded the API pagination limit")

    def accounts(self):
        for account in ACCOUNTS:
            credentials = {"email": account["email"], "password": self.password}
            login = self.client.post("/auth/login", json=credentials)
            if login.status_code == 401:
                created = self.client.post(
                    "/auth/register",
                    json={
                        **credentials,
                        "display_name": account["display_name"],
                        "role": account["role"],
                    },
                )
                if created.status_code == 409:
                    raise RuntimeError(
                        f"{account['email']} already exists with another password; it was not changed"
                    )
                if created.status_code != 201:
                    raise RuntimeError(
                        f"Could not register {account['email']}: HTTP {created.status_code}"
                    )
                self.counts["new_accounts"] += 1
                login = self.client.post("/auth/login", json=credentials)
            else:
                self.counts["reused_accounts"] += 1
            if login.status_code != 200:
                raise RuntimeError(
                    f"Could not authenticate demo account {account['email']}"
                )
            key = account["key"]
            self.tokens[key] = login.json()["access_token"]
            user = self.request("GET", "/users/me", key).json()
            if (
                user["role"] != account["role"]
                or user["display_name"] != account["display_name"]
            ):
                raise RuntimeError(
                    f"Existing profile {account['email']} does not match the demo fixture; it was not changed"
                )
            self.users[key] = user

    def listings(self):
        for index, (owner, city, state, latitude, longitude) in enumerate(PLACES):
            existing = self.pages("/listings/mine", owner)
            for slot, (label, status, price, area) in enumerate(
                [
                    ("Residential Plot", "active", "4500000.00", "300.00"),
                    ("Roadside Land", "active", "7800000.00", "650.00"),
                    ("Private Draft", "draft", "3200000.00", "240.00"),
                    ("Sold Plot", "sold", "5900000.00", "420.00"),
                ]
            ):
                title = f"{PREFIX} {city} {label}"
                matches = [row for row in existing if row["title"] == title]
                if len(matches) > 1:
                    raise RuntimeError(
                        f"Multiple demo listings named {title}; no duplicate was created"
                    )
                if matches:
                    listing = matches[0]
                    self.counts["reused_listings"] += 1
                else:
                    listing = self.request(
                        "POST",
                        "/listings",
                        owner,
                        json={
                            "title": title,
                            "description": f"{PREFIX} Synthetic {label.lower()} for testing listings, maps and owner contact. Sample location only; not a real property offer.",
                            "price": price,
                            "currency": "INR",
                            "area_sq_m": area,
                            "address": f"Demo Plot {slot + 1}, Sample Layout Road",
                            "city": city,
                            "state": state,
                            "country": "IN",
                            "latitude": latitude,
                            "longitude": longitude,
                            "status": status,
                        },
                    ).json()
                    self.counts["new_listings"] += 1
                if not listing["images"]:
                    photo = sample_photo(title, city, index + slot)
                    self.request(
                        "POST",
                        f"/listings/{listing['id']}/images",
                        owner,
                        files={"file": ("demo-plot.jpg", photo, "image/jpeg")},
                    )
                    self.counts["new_images"] += 1

    def message(self, conversation: dict, actor: str, key: str, body: str):
        response = self.request(
            "POST",
            f"/conversations/{conversation['id']}/messages",
            actor,
            json={
                "client_id": stable_id(f"{conversation['id']}:{actor}:{key}"),
                "body": body,
            },
        )
        self.counts[
            "new_messages" if response.status_code == 201 else "reused_messages"
        ] += 1

    def group(self, owner: str, name: str, keys: list[str]) -> tuple[dict, bool]:
        existing = [
            row
            for row in self.pages("/conversations", owner)
            if row["kind"] == "group"
            and row["owner_id"] == self.users[owner]["id"]
            and row["name"] == name
        ]
        if len(existing) > 1:
            raise RuntimeError(
                "Multiple matching demo groups exist; no new group was created"
            )
        if existing:
            self.counts["reused_groups"] += 1
            return existing[0], False
        group = self.request(
            "POST",
            "/conversations/groups",
            owner,
            json={
                "name": name,
                "member_ids": [self.users[key]["id"] for key in keys if key != owner],
            },
        ).json()
        self.counts["new_groups"] += 1
        return group, True

    def chats(self):
        for sender, recipient in [
            ("buyer1", "seller1"),
            ("buyer1", "broker1"),
            ("buyer2", "seller2"),
            ("buyer2", "broker2"),
            ("buyer1", "buyer2"),
            ("seller1", "broker1"),
            ("seller2", "broker2"),
        ]:
            response = self.request(
                "POST",
                "/conversations/direct",
                sender,
                json={"recipient_id": self.users[recipient]["id"]},
            )
            self.counts[
                "new_direct_chats"
                if response.status_code == 201
                else "reused_direct_chats"
            ] += 1
            chat = response.json()
            self.message(
                chat,
                sender,
                "hello",
                "Hello! This is a demo conversation about land listings.",
            )
            self.message(
                chat,
                recipient,
                "reply",
                "Welcome! Use the audio or video call buttons to test in-app calling.",
            )
        community, created = self.group(
            "buyer1", f"{PREFIX} LandConnect Community", list(self.users)
        )
        if created:
            self.request(
                "PATCH",
                f"/conversations/{community['id']}/members/{self.users['seller1']['id']}",
                "buyer1",
                json={"role": "admin"},
            )
        for account in ACCOUNTS:
            self.message(
                community,
                account["key"],
                "introduction",
                f"Hi, I am {account['display_name']}. This group connects the six demo profiles for messaging and meetings.",
            )
        site, _created = self.group(
            "broker1", f"{PREFIX} Pune Site Visit", ["broker1", "buyer1", "seller1"]
        )
        for actor, body in [
            ("buyer1", "Can we review the sample site location together?"),
            (
                "seller1",
                "The demo plot is marked on the map. This is sample data only.",
            ),
            (
                "broker1",
                "Use the meeting invitation for a group audio/video discussion.",
            ),
        ]:
            self.message(site, actor, "site-intro", body)

    def meetings(self):
        for key, owner, kind, guests in [
            (
                "video",
                "broker1",
                "video",
                [key for key in self.users if key != "broker1"],
            ),
            ("audio", "seller2", "audio", ["buyer2", "broker2"]),
        ]:
            response = self.request(
                "POST",
                "/meetings",
                owner,
                json={
                    "client_id": stable_id("meeting:" + key),
                    "title": f"{PREFIX} {'Land Discussion' if key == 'video' else 'Buyer Briefing'}",
                    "kind": kind,
                    "member_ids": [self.users[guest]["id"] for guest in guests],
                },
            )
            self.counts[
                "new_meetings" if response.status_code == 201 else "reused_meetings"
            ] += 1

    def verify(self):
        for account in ACCOUNTS:
            profile = self.request("GET", "/users/me", account["key"]).json()
            assert profile["role"] == account["role"]
        for key in ("buyer1", "buyer2"):
            denied = self.client.get(
                "/listings/mine",
                headers={"Authorization": "Bearer " + self.tokens[key]},
            )
            assert denied.status_code == 403, (
                "Buyer listing-management access should be denied"
            )
        public = self.request(
            "GET", "/listings", params={"q": PREFIX, "limit": 100}
        ).json()["items"]
        assert public and all(row["status"] == "active" for row in public)
        picture = public[0]["images"][0]
        photo = self.request("GET", picture["url"])
        assert (
            photo.headers["content-type"].startswith("image/jpeg")
            and photo.content[:2] == b"\xff\xd8"
        )
        assert self.request("GET", "/listings/map", params={"q": PREFIX}).json()[
            "features"
        ]
        self.counts["public_demo_listings"] = len(public)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=private_origin, required=True)
    args = parser.parse_args()
    password = os.getenv("LANDCONNECT_DEMO_PASSWORD", PASSWORD)
    if not 12 <= len(password) <= 128:
        parser.error("LANDCONNECT_DEMO_PASSWORD must contain 12 to 128 characters")
    try:
        with httpx.Client(
            base_url=args.base_url, timeout=30, follow_redirects=False
        ) as client:
            seed = DemoSeed(client, password)
            assert seed.request("GET", "/health/ready").json()["status"] == "ready"
            seed.accounts()
            seed.listings()
            seed.chats()
            seed.meetings()
            seed.verify()
            print("Demo data ready; existing data was not reset.")
            for label, count in sorted(seed.counts.items()):
                print(f"{label}: {count}")
            print("Verified logins:")
            for account in ACCOUNTS:
                print(f"{account['role']}: {account['email']}")
            print(
                "Password: value of LANDCONNECT_DEMO_PASSWORD"
                if password != PASSWORD
                else f"Demo password: {PASSWORD}"
            )
            print(
                "No active calls or media rooms were created. Meetings remain invitations."
            )
    except (httpx.HTTPError, RuntimeError, AssertionError) as error:
        if isinstance(error, RuntimeError):
            parser.exit(1, f"Demo seeding stopped: {error}\n")
        parser.exit(
            1,
            "Demo seeding could not finish. Check API health and retry; no reset was performed.\n",
        )


if __name__ == "__main__":
    main()
