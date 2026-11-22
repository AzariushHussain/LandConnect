# LandConnect

A land marketplace mobile application, built in stages. The current checkpoint includes **authentication, property listings, images, maps, direct/group messaging, privacy controls and self-hosted SFU infrastructure**, on FastAPI, PostgreSQL, Alembic, Redis and Docker. Call lifecycle APIs and the calling interface come next.

## Calling architecture

The agreed media architecture is **WebRTC through a self-hosted LiveKit SFU**, for both one-to-one calls and invite-only group meeting rooms. Mobile clients publish audio/video tracks to the SFU, which forwards them to the other participants. FastAPI owns authentication, invitations, membership checks, call state and short-lived room access tokens. LiveKit owns media transport and its WebRTC signaling.

The `livekit-api` dependency supplies server-side room management and token generation. **LiveKit Server v1.13.11 now runs in Compose**, with the same credentials as the backend and local TURN/UDP support. We use its WebRTC media infrastructure; no Agents framework, AI models or LiveKit Cloud subscription are involved. Calling endpoints and client audio/video testing are still pending. See the [setup walkthrough](docs/09-livekit-setup.md), [setup PDF](docs/LandConnect%20LiveKit%20Setup%20Guide.pdf) and earlier [SFU architecture decision](docs/04-sfu-architecture.md).

## Chat architecture

Direct and group chat use **PostgreSQL message history and a transactional outbox, Redis Pub/Sub fan-out, and authenticated WebSockets**. Redis carries small change notifications; it is not the message store. Each API instance forwards broker events to its own connected clients after authorization checks. Reconnects recover messages from paginated PostgreSQL history. See the [chat architecture decision](docs/07-chat-architecture.md) and [implementation guide](docs/08-messaging.md).

## Start the backend

Requirements: Git, uv and Docker Desktop running Linux containers. Run these commands from the LandConnect directory:

```powershell
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
docker compose up --build -d
```

`uv sync` creates or reuses `backend/.venv`. You can use `uv run` without activating it. The setup script generates a local `.env` with random secrets and preserves an existing `.env`. Both `.env` and `.venv` are excluded from Git.

Open [Swagger API documentation](http://localhost:8000/docs). The first image build downloads dependencies; the API starts after PostgreSQL, Redis and LiveKit are healthy and the migration service succeeds.

```powershell
Invoke-RestMethod http://localhost:8000/health/live
Invoke-RestMethod http://localhost:8000/health/ready
docker compose ps -a
docker compose logs --tail=50 api migrate
```

Readiness returns `503` when PostgreSQL is unavailable, its Alembic revision differs from the migration files, or the local Redis subscriber is disconnected. It does not check LiveKit continuously, verify media transport or guarantee notification delivery. LiveKit has its own Compose HTTP health check and a separate authenticated smoke check below.

Default local ports are API `8000`, PostgreSQL `55432` and Redis `56379`. They bind to the local computer only. To use different ports, update `API_PORT`, `POSTGRES_PORT` or `REDIS_PORT` in `.env`; keep host URLs in `DATABASE_URL` and `REDIS_URL` consistent. Compose uses `DOCKER_DATABASE_URL` for PostgreSQL and `redis://redis:6379/0` for Redis internally. Existing `.env` files can use the default Redis settings without being regenerated.

Use a unique `CHAT_CHANNEL_PREFIX` per deployment sharing Redis. Pub/Sub channels are independent of Redis database numbers. Local Redis has no password and is intended for this loopback development stack; configure authentication, TLS and network access for hosted infrastructure.

If you customize database credentials, keep `POSTGRES_*` and both connection URLs consistent. URL-encode special characters in connection URLs. PostgreSQL initialization settings apply when its data volume is first created; changing `.env` does not change an existing database password.

## LiveKit infrastructure

```powershell
docker compose up -d livekit
uv run --project backend python scripts/check_livekit.py
docker compose ps livekit
```

The check creates a uniquely named temporary room, lists it, deletes it and verifies deletion. It also rejects a request signed with an incorrect secret, checks the STUN/UDP binding response on `3478`, and connects to ICE/TCP `7881`. It never displays credentials or existing room names. Passing this check does **not** prove audio/video playback or TURN media relay; those require clients in the next calling checkpoint.

| Port | Purpose |
| --- | --- |
| `7880/TCP` | LiveKit HTTP control API and WebSocket signaling |
| `7881/TCP` | ICE/TCP media fallback |
| `7882/UDP` | Multiplexed WebRTC media |
| `3478/UDP` | Embedded TURN/UDP, also serving STUN |
| `30000–30049/UDP` | Bounded TURN relay allocation range for local testing |

All LiveKit mappings bind to `LIVEKIT_BIND_IP`, default `127.0.0.1`. Keep RTC and TURN port numbers unchanged in this local configuration: clients receive those advertised port numbers. `infra/livekit/livekit.local.yaml` contains the non-secret server settings; Compose injects `LIVEKIT_KEYS` from the existing key/secret and supplies the advertised `NODE_IP`. There is no hardcoded development secret or `--dev` mode. Preserve the generated URL-safe credentials, and do not publish expanded Compose configuration because it contains secrets.

For a host process, `LIVEKIT_INTERNAL_URL` defaults to `http://localhost:7880`; Compose overrides it to `http://livekit:7880` for the API container. `LIVEKIT_PUBLIC_URL` defaults to `ws://localhost:7880`, and `LIVEKIT_NODE_IP` defaults to `127.0.0.1`. Public URL and advertised media IP are different settings and both must be reachable by clients. An existing `.env` remains valid with the default bind IP.

For a physical phone on the same trusted Wi-Fi, set `LIVEKIT_BIND_IP` and `LIVEKIT_NODE_IP` to the computer's LAN IPv4 address, and set `LIVEKIT_PUBLIC_URL=ws://<LAN-IP>:7880` and host `LIVEKIT_INTERNAL_URL=http://<LAN-IP>:7880`. Recreate the service with `docker compose up -d --force-recreate livekit` and permit the listed ports in the host firewall. The phone's `localhost` means the phone itself. These changes expose the SFU only; the API remains bound to loopback until mobile access is configured during client integration.

This is a single-node local setup. TURN permits local/private peers and has 50 relay ports; it has not been load-tested. Public deployment needs reachable media addresses, appropriate network policy, HTTPS/WSS certificates and TURN/TLS for restrictive networks. The server may warn about Docker's UDP buffer size; tune that on the deployment host when testing production load. Rooms must be created explicitly by an authenticated server API because `room.auto_create` is disabled. This is infrastructure preparation, not the application's invitation/permission enforcement.

## Run the API locally with uv

Keep PostgreSQL and Redis in Docker and run a second development API on port `8001`:

```powershell
docker compose up -d db redis
uv run --directory backend python -m alembic upgrade head
uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Local API documentation: <http://localhost:8001/docs>. Root `.env` settings load independently of the working directory. Containers receive settings through Compose environment variables.

## Authentication

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /auth/register` | JSON email, password, display_name and optional role | `201` user profile; role defaults to buyer |
| `POST /auth/login` | JSON email and password | `200` bearer access token and expires_in seconds |
| `GET /users/me` | `Authorization: Bearer <access_token>` | `200` authenticated user's profile |

Use `/docs` to register and log in. Copy `access_token` from the login response, click **Authorize**, paste the token alone and try `/users/me`. Swagger supplies the Bearer prefix. Other API clients must send the full Authorization header. Login accepts JSON, rather than an OAuth2 password form.

Registration supports `buyer`, `seller` and `broker`. Emails are normalized to lowercase; duplicate accounts return `409`. Passwords must be 12 through 128 characters and are stored as Argon2id hashes. Password whitespace is preserved. User responses omit password hashes, and validation errors omit submitted values.

Access tokens use HS256 and expire after `ACCESS_TOKEN_MINUTES` (default 60). Signature, issuer, audience, expiry, issue time, subject and token purpose are checked. Protected requests load the current user and role from PostgreSQL. `require_roles(Role.seller, Role.broker)` protects listing creation, editing, archiving and image management. Ownership checks additionally prevent one seller from managing another seller's properties.

This is the prototype's access-token flow. Refresh tokens, logout revocation, password recovery and email verification are not implemented. Shared login throttling and HTTPS must be provided before public deployment. Local Compose ports remain bound to the computer's loopback interface.

## Listings and maps

| Endpoint | Behavior |
| --- | --- |
| `GET /listings` | Public active listings with filters and pagination |
| `GET /listings/map` | Active listings as GeoJSON points, with the same filters |
| `GET /listings/mine` | Seller/broker's own listings, optionally filtered by status |
| `POST /listings` | Seller/broker creates a listing; default status is draft |
| `GET /listings/{id}` | Active listing publicly; other statuses only for its authenticated owner |
| `PATCH /listings/{id}` | Owner edits supplied fields or changes status |
| `DELETE /listings/{id}` | Owner archives the listing; preserves its record and images |
| `POST /listings/{id}/images` | Owner uploads one multipart `file` |
| `GET /listings/{id}/images/{image_id}` | JPEG bytes with the same visibility rules as the listing |
| `DELETE /listings/{id}/images/{image_id}` | Owner removes the image record and file |

Create a draft in Swagger, upload its images, then PATCH `{"status":"active"}` to publish. The active community feed excludes drafts, sold properties and archived properties. Owners can inspect those through `/listings/mine` or an authenticated detail request and can restore them with PATCH. There is no permanent listing-deletion endpoint in this stage.

Filters: `q`, `city`, `state`, `country`, `currency`, `min_price`, `max_price`, `min_area`, `max_area`, and a complete bounding box (`south`, `north`, `west`, `east`). Search treats `%` and `_` literally. West greater than east selects a box across the date line. `limit` defaults to 20 and is capped at 100; `offset` ranges from 0 to 10000. Responses include the filtered total. Only `/listings/mine` accepts a `status` filter.

Prices and areas are positive decimals with up to two fractional digits; area is in square metres. Country and currency fields use uppercase two-letter and three-letter formats. Coordinates allow six fractional digits and valid latitude/longitude ranges. JSON decimal values are returned as strings; map geometry contains numeric `[longitude, latitude]` pairs. Prices are not converted between currencies: specify `currency` when comparing amounts.

Uploads accept JPEG, PNG and WebP, at most 5 MiB and 12 million pixels each, with up to 10 images per listing. Images are normalized to JPEG, resized within 2048 by 2048, oriented from EXIF, and stripped of original metadata. Animated images are rejected. Every HTTP request is capped at 6 MiB, including streamed bodies. Client filenames are ignored. Image URLs are relative to the API base URL; send the owner's bearer token to preview an unpublished image.

Files live in the configured `UPLOAD_DIR`, anchored to `backend/` when relative, and in the persistent uploads volume in Docker. They are served through visibility-checked endpoints rather than a public static directory. Local files and PostgreSQL are separate storage systems; crash recovery and multi-instance storage need reconciliation/shared storage beyond this prototype.

## Messaging and privacy

All REST endpoints below require a bearer token. Conversation responses contain public member summaries (ID, display name and marketplace role), without email addresses or phone numbers.

| Endpoint | Behavior |
| --- | --- |
| `POST /conversations/direct` | `{recipient_id}`; creates or returns the pair's unique direct conversation |
| `POST /conversations/groups` | `{name, member_ids}`; owner plus 1–49 other members |
| `GET /conversations` | Current memberships, with limit/offset pagination |
| `GET /conversations/{id}` | Current member reads conversation details |
| `PATCH /conversations/{id}` | Owner/admin renames a group with `{name}` |
| `POST /conversations/{id}/members` | Owner/admin adds `{user_id}` |
| `PATCH /conversations/{id}/members/{user_id}` | Owner sets `{role: "admin"}` or `"member"` |
| `POST /conversations/{id}/ownership` | Owner transfers ownership to current `{user_id}` |
| `DELETE /conversations/{id}/members/me` | Leaves group; owner must first transfer ownership |
| `DELETE /conversations/{id}/members/{user_id}` | Owner/admin removes member; only owner removes admins |
| `POST /conversations/{id}/messages` | `{client_id: "UUID", body: "text"}`; durable send |
| `GET /conversations/{id}/messages` | History with `limit`, exclusive `after_id` or `before_id` |
| `PATCH /users/me/privacy` | Updates `allow_messages` and/or `allow_calls` booleans |
| `GET /users/me/blocks` | Paginated accounts blocked by the current user |
| `PUT /users/me/blocks/{user_id}` | Blocks an account, idempotently |
| `DELETE /users/me/blocks/{user_id}` | Unblocks an account, idempotently |

Messages are nonblank text of at most 4000 characters. Generate one `client_id` UUID per logical send and reuse it on retry. An identical retry returns the existing message (`200`, versus `201` for new); reusing that UUID with different text returns `409`. There are no message edits, deletion or attachments in this stage.

History defaults to the latest 50 messages, returned in ascending ID order. Use `before_id=next_before_id` for older pages. For recovery use `after_id=<last_received_id>` (or `0` for all history), then advance through `next_after_id` while `has_more` is true. Do not advance a cursor from a notification alone: fetch history through that point first. Cursor gaps across conversations are expected. Current members can read all retained group history, including messages before joining. Removed members immediately lose read/send access; rejoining restores that history.

Group owner/admin roles are separate from buyer/seller/broker roles. Owners cannot leave until transferring ownership. Direct participants are fixed. Membership checks also guard realtime hints. Missing conversations and conversations unavailable to the caller return `404`.

Blocks in either direction and a recipient's `allow_messages=false` prevent direct sends and new invitations. A new group or member addition cannot introduce a blocked pair. An existing shared group remains shared if someone later blocks another member or disables incoming messages: leave the group to stop sharing it. Changing these settings does not erase existing direct history. `allow_calls` is stored now for the upcoming calling stage.

Connect a WebSocket to `ws://localhost:8000/ws/chat`. Within five seconds, send `{"type":"auth","token":"<access_token>"}` as the first frame. The server replies `{"type":"ready","user_id":"..."}`. Tokens never appear in the URL. Browser origins must be in `CORS_ORIGINS`; native clients may omit Origin. Send `{"type":"pong"}` when the server sends `{"type":"ping"}`. Message writes stay on REST.

Notifications include `event_id`, `type`, `conversation_id`, `actor_id` and optional `message_id`/`target_user_id`; they omit text. Types are `message.created`, `conversation.updated` and `membership.removed`. Deduplicate by `event_id`, fetch authorized REST state, and periodically reconcile history even while connected. Pub/Sub is at-most-once; outbox retry can produce duplicates and events can arrive out of order. A notification is not a delivery/read receipt. On disconnect, reconnect and recover REST history. Close `1013` asks for retry/recovery; `1008` requires checking authentication/protocol, including expired tokens. Each user has at most five sockets per API process; slow consumers are disconnected when their bounded queue fills.

The outbox commits with the message, then API background relays claim pending rows with `FOR UPDATE SKIP LOCKED`, publish to server-derived per-user Redis channels, and record publication. A failed broker publish leaves the row pending. Successful publication does not mean a client received it. Published outbox rows currently remain stored; add monitored retention/cleanup before sustained production use. Push notifications, typing/presence, delivery/read receipts and end-to-end encryption are later work.

## Database migrations

```powershell
uv run --directory backend python -m alembic current
uv run --directory backend python -m alembic check
```

After a model change, generate a new migration, review its `upgrade` and `downgrade`, then apply it:

```powershell
uv run --directory backend python -m alembic revision --autogenerate -m "describe the schema change"
uv run --directory backend python -m alembic upgrade head
```

Commit reviewed migrations with their model changes. Rebuild the image when code or migrations change. `docker compose up --build -d` applies pending migrations through the one-off `migrate` service before starting the API. The application never creates tables with `create_all`.

The current revision is `0002_chat`. It preserves old direct conversations/messages, backfills their memberships, and adds groups, client retry keys and the outbox. Downgrade refuses while group conversations exist because the old schema cannot represent them.

## Checks

Run unit tests and code checks from the project root:

```powershell
uv run --directory backend python -m pytest -q
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
```

Without `TEST_POSTGRES_URL`, nine PostgreSQL integration tests are skipped. Two also require `TEST_REDIS_URL`. To run the complete suite against the development services configured in `.env`:

```powershell
uv run --directory backend python -c "import os,pytest; from app.core.config import get_settings; s=get_settings(); os.environ['TEST_POSTGRES_URL']=s.database_url; os.environ['TEST_REDIS_URL']=s.redis_url; raise SystemExit(pytest.main(['-q']))"
```

Integration tests create unique temporary schemas and remove them after use. They check authentication, listings, schema/model consistency, migration preservation/rollback, concurrent send/removal and retry behavior, real Redis cross-instance fan-out, and subscriber reconnect/history recovery. Redis tests use unique channel prefixes and kill only their own subscriber connection. The database user needs permission to create schemas. Current validation: **157 tests passed**, plus the real LiveKit smoke check and an authenticated control API request from inside the API container. Three new unit cases check temporary-room cleanup on failure and STUN transaction validation. The installed TestClient emits one upstream HTTPX deprecation warning.

## Files and explanations

- `backend/app/main.py`: application assembly, CORS and lifecycle management.
- `backend/app/api/router.py`: central API route registration.
- `backend/app/api/routes/health.py`: liveness and readiness endpoints.
- `backend/app/api/routes/auth.py` and `users.py`: registration, login and private profile endpoints.
- `backend/app/api/routes/listings.py`: community, ownership, upload and geographic endpoints.
- `backend/app/api/routes/conversations.py` and `websocket.py`: messaging REST and authenticated realtime endpoints.
- `backend/app/api/deps.py`: authenticated-user and role dependencies.
- `backend/app/api/errors.py`: validation responses that omit submitted values.
- `backend/app/api/middleware.py`: total request-body size limit.
- `backend/app/core/config.py`: environment validation and cached settings.
- `backend/app/core/security.py`: password hashing and access-token creation/validation.
- `backend/app/schemas/`: validated request and response contracts.
- `backend/app/services/auth.py`: account creation and credential verification.
- `backend/app/services/listings.py` and `media.py`: property queries, transactions and safe image storage.
- `backend/app/services/chat.py`, `chat_outbox.py` and `realtime.py`: membership/privacy rules, transactional broker relay and local WebSocket fan-out.
- `backend/app/db/base.py`: declarative base and constraint naming conventions.
- `backend/app/db/session.py`: connection engine and request session dependency.
- `backend/app/models/`: one file per entity, shared enums, helpers and explicit model exports.
- `backend/tests/unit/` and `backend/tests/integration/`: isolated unit and PostgreSQL checks.
- `backend/alembic/`: versioned schema changes, starting at `0001_initial`.
- `backend/Dockerfile` and `compose.yaml`: API image, PostgreSQL, Redis and migration startup.
- `infra/livekit/livekit.local.yaml`: local SFU, ICE and TURN configuration; credentials come from Compose.
- `scripts/check_livekit.py`: authenticated room lifecycle and local connectivity smoke check.
- [Step 1 guide](docs/LandConnect%20Backend%20Step%201%20Guide.pdf): initial scaffold explanation and full assignment roadmap.
- [Step 2 explanation](docs/02-backend-foundation.md) and [PDF guide](docs/LandConnect%20Backend%20Step%202%20Guide.pdf): foundation checkpoint before the directory refactor.
- [Backend structure explanation](docs/03-backend-structure.md): current directory tree, imports and the rules for adding models and future features.
- [Backend structure PDF guide](docs/LandConnect%20Backend%20Structure%20Guide.pdf): printable explanation of the refactor.
- [Authentication explanation](docs/05-authentication.md) and [PDF guide](docs/LandConnect%20Authentication%20Guide.pdf): the authentication checkpoint.
- [Listings explanation](docs/06-listings.md) and [PDF guide](docs/LandConnect%20Listings%20Guide.pdf): uploads, maps and property management.
- [Messaging explanation](docs/08-messaging.md) and [PDF guide](docs/LandConnect%20Messaging%20Guide.pdf): direct/group chat, Pub/Sub, privacy, code walkthrough and client protocol.
- [LiveKit setup explanation](docs/09-livekit-setup.md) and [PDF guide](docs/LandConnect%20LiveKit%20Setup%20Guide.pdf): this infrastructure checkpoint and the boundaries of its verification.

The structure separates HTTP handlers, configuration, persistence and models. Import `get_settings` from `app.core.config` and `get_db` from `app.db.session`. Import individual models from their modules or use the public exports in `app.models`. The models package imports every entity so Alembic receives the complete metadata registry. Importing it does not initialize a database engine.

Git is initialized at the project root on `main`. Keep `uv.lock` in Git; `.env` and virtual environments are excluded.

## Stop the containers

```powershell
docker compose down
```

PostgreSQL data and uploads are stored in named volumes, which this command preserves. Redis notifications are transient; PostgreSQL retains message history and pending outbox rows. LiveKit rooms are runtime state, and restarting the SFU disconnects participants. The next checkpoint is **call lifecycle APIs, privacy checks, room tokens and realtime call events**, after you say **next**. Invite-only meetings, the mobile interface and end-to-end media demonstrations follow.
