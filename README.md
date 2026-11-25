# LandConnect

A land marketplace Android prototype for buyers, sellers and brokers, with property discovery, messaging and in-app audio/video calls.

## Features

- Registration, login and Buyer/Seller/Broker permissions.
- Property browsing, search, filters, photos and location details.
- Seller/broker listing creation, editing, publishing and image uploads.
- Property maps, place search and address prefill from a selected point.
- Direct/group messaging, participant management and call history.
- Direct/group audio and video calls, plus invite-only meeting rooms.
- Contact blocking/unblocking and communication preferences.

## Technical overview

| Layer           | Technologies                                        |
| --------------- | --------------------------------------------------- |
| Android app     | React Native, TypeScript, Expo Router               |
| API             | FastAPI, SQLAlchemy, JWT authentication             |
| Database        | PostgreSQL, Alembic migrations                      |
| Messaging       | Redis Pub/Sub, authenticated WebSockets             |
| Calling         | WebRTC through a self-hosted LiveKit SFU            |
| Maps            | MapLibre, OpenFreeMap, Photon geocoding             |
| Backend runtime | Docker Compose, Python dependencies managed with uv |

FastAPI enforces roles, ownership, conversation membership and privacy rules. PostgreSQL stores application data and message history. A transactional outbox publishes change notifications through Redis; WebSockets deliver them to authorized clients, and reconnects recover history from PostgreSQL.

For calls, FastAPI manages invitations, call state and short-lived room tokens. LiveKit handles WebRTC signaling and audio/video transport. Both direct and group calls use the SFU architecture.

## Run locally

Requirements: Git, uv, Python 3.12/3.13, Docker Desktop with Linux containers and Compose 2.24.4+, Node.js, JDK 17 and the Android SDK. Use an Android device with debugging enabled.

Keep the checkout in a short path such as `C:\code\LandConnect` on Windows. Replace `192.168.29.22` below with your computer's private IPv4 address. The phone and computer must be on the same network.

**Backend - PowerShell, terminal 1:**

```powershell
git clone https://github.com/AzariushHussain/LandConnect.git
cd LandConnect
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
uv run --project backend python scripts/start_lan.py --host 192.168.29.22
```

The helper starts the API, PostgreSQL, Redis and LiveKit, applies migrations and waits for service health. Existing `.env` files and data volumes are preserved. API documentation: `http://192.168.29.22:8000/docs`; readiness: `/health/ready`.

**Android app - PowerShell, terminal 2, from the repository root:**

```powershell
cd mobile
npm ci
$env:EXPO_PUBLIC_API_URL = "http://192.168.29.22:8000"
npm run android -- --device
```

This builds/installs the development client and starts Metro. For later JavaScript-only development, use `npm start` from `mobile/` with the same API setting. Expo Go is not supported because calling uses native WebRTC modules.

The development APK is generated at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. It requires Metro and the backend. Keep local secrets in the root `.env`; never put backend secrets in mobile configuration.

## Demo accounts

After starting the backend, optionally create/reuse the synthetic demo data:

```powershell
uv run --project backend python scripts/seed_demo.py --base-url http://192.168.29.22:8000
```

| Role   | Accounts                                     |
| ------ | -------------------------------------------- |
| Buyer  | `buyer1@example.com`, `buyer2@example.com`   |
| Seller | `seller1@example.com`, `seller2@example.com` |
| Broker | `broker1@example.com`, `broker2@example.com` |

Shared demo password: `LandConnect@123`. These are local sample accounts and listings, not production credentials or real offers.

## Checks

From the repository root:

```powershell
uv run --project backend python -m pytest backend/tests/unit -q
uv run --project backend ruff check backend scripts
cd mobile
npm run typecheck
npm run lint
npm test
npm run format:check
```

## Project layout

```text
backend/app/       API routes, services, schemas and models
backend/alembic/   Database migrations
backend/tests/     Unit and integration tests
mobile/src/       App routes, features and shared UI
infra/livekit/    SFU configuration
scripts/          Setup, demo data and connectivity helpers
```

## Prototype notes

Calling currently requires the app to remain foregrounded. Formal meeting rooms and advanced privacy settings exist as routes, but their main-menu shortcuts are hidden. Direct-chat blocking and My Account > Blocked contacts are available in the normal UI.

ChatGPT/Codex assisted with planning, implementation, debugging and documentation.

To stop the backend while preserving database/upload volumes, run `docker compose down` from the repository root.
